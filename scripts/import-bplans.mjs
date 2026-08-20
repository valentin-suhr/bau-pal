#!/usr/bin/env node

import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const WFS_URL = "https://gdi.berlin.de/services/wfs/bplan";
const LAYERS = {
  fixed: { typeName: "bplan:b_bp_fs", status: "in_force" },
  process: { typeName: "bplan:a_bp_iv", status: "in_process" },
  repealed: { typeName: "bplan:c_bp_ak", status: "superseded" },
};

function option(name, fallback) {
  const prefix = `--${name}=`;
  const match = process.argv.find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function positiveInteger(value, name) {
  const result = Number(value);
  if (!Number.isInteger(result) || result <= 0) throw new Error(`${name} must be a positive integer`);
  return result;
}

function parseBbox(value) {
  if (!value) return null;
  const bbox = value.split(",").map(Number);
  if (bbox.length !== 4 || bbox.some((item) => !Number.isFinite(item))) {
    throw new Error("bbox must be west,south,east,north in EPSG:4326");
  }
  if (bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) throw new Error("bbox bounds are invalid");
  return bbox;
}

function visitCoordinates(coordinates, visit) {
  if (typeof coordinates?.[0] === "number") return visit(coordinates[0], coordinates[1]);
  for (const child of coordinates ?? []) visitCoordinates(child, visit);
}

function geometryBbox(geometry) {
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  visitCoordinates(geometry.coordinates, (x, y) => {
    bbox[0] = Math.min(bbox[0], x);
    bbox[1] = Math.min(bbox[1], y);
    bbox[2] = Math.max(bbox[2], x);
    bbox[3] = Math.max(bbox[3], y);
  });
  if (!bbox.every(Number.isFinite)) throw new Error("B-Plan feature has unusable geometry");
  return bbox;
}

function planType(value = "") {
  const text = value.toLowerCase();
  if (text.includes("vorhaben")) return "project_bplan";
  if (text.includes("qualifiziert")) return "qualified_bplan";
  if (text.includes("einfach")) return "simple_bplan";
  return "other";
}

function borough(value) {
  return value ? String(value).replace(/^\d+\s*-\s*/, "").trim() : null;
}

function parseRelationList(value, relation, direction = "current_to_target") {
  if (!value) return [];
  return String(value).split(/\s*[,;]\s*/).filter(Boolean).map((raw) => {
    const match = raw.match(/^(\d+)\s*\((.+)\)$/);
    return { relation, direction, targetPlanId: match?.[1] ?? null, targetPlanKey: match?.[2] ?? raw, raw };
  });
}

export function normalizeBplanFeature(feature, layer, collectionTimestamp) {
  const properties = feature.properties ?? {};
  const geometry = feature.geometry;
  if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) {
    throw new Error(`Unsupported geometry for ${feature.id ?? "unknown B-Plan"}`);
  }
  const key = String(properties.planname ?? properties.planid ?? "").trim();
  if (!key) throw new Error(`B-Plan feature ${feature.id ?? "unknown"} has no plan identifier`);
  const relations = [
    ...parseRelationList(properties.ersetztteil, "partially_supersedes"),
    ...parseRelationList(properties.ersetztvoll, "supersedes"),
    ...parseRelationList(properties.ersetztdurchteil, "partially_supersedes", "target_to_current"),
    ...parseRelationList(properties.ersetztdurchvoll, "supersedes", "target_to_current"),
  ];
  return {
    planKey: key,
    officialPlanId: properties.planid ? String(properties.planid) : null,
    title: `Bebauungsplan ${key}`,
    planType: planType(properties.planartname),
    officialPlanType: properties.planartname ?? null,
    procedureType: properties.verfahrensart ?? null,
    status: LAYERS[layer].status,
    legalStatus: properties.bp_rechtsstand ?? null,
    borough: borough(properties.bezirk),
    scopeDescription: properties.bereich ?? null,
    contents: properties.inhalt ?? null,
    effectiveFrom: properties.festsetzungsdatum ?? properties.rechtsverbindlich ?? null,
    scanUrl: properties.scan_www ?? null,
    rationaleUrl: properties.grund_www ?? null,
    detailUrl: properties.url_www ?? null,
    sourceFeatureId: feature.id ?? properties.gisid ?? null,
    sourceTimestamp: collectionTimestamp ?? null,
    zoneKey: `${key}:scope`,
    geometryGeojson: JSON.stringify(geometry),
    bbox: feature.bbox ?? geometryBbox(geometry),
    relations,
  };
}

async function fetchPage({ layer, bbox, count, startIndex }) {
  const url = new URL(WFS_URL);
  url.search = new URLSearchParams({
    service: "WFS", version: "2.0.0", request: "GetFeature",
    typeNames: LAYERS[layer].typeName, outputFormat: "application/json",
    srsName: "EPSG:4326", startIndex: String(startIndex), count: String(count),
    ...(bbox ? { bbox: `${bbox.join(",")},EPSG:4326` } : {}),
  }).toString();
  const response = await fetch(url, { headers: { "user-agent": "Grounded-Berlin-bplan-import/1.0" } });
  if (!response.ok) throw new Error(`B-Plan WFS returned ${response.status} ${response.statusText}`);
  return response.json();
}

async function main() {
  const layer = option("layer", "fixed");
  if (!LAYERS[layer]) throw new Error(`layer must be one of ${Object.keys(LAYERS).join(", ")}`);
  const output = resolve(option("output", `data/import/bplans-${layer}.ndjson`));
  const bbox = parseBbox(option("bbox", ""));
  const pageSize = positiveInteger(option("page-size", "500"), "page-size");
  const limitText = option("limit", "");
  const limit = limitText ? positiveInteger(limitText, "limit") : Infinity;
  await mkdir(dirname(output), { recursive: true });
  const writer = createWriteStream(output, { encoding: "utf8" });
  let startIndex = 0;
  let written = 0;
  let matched = Infinity;
  while (startIndex < matched && written < limit) {
    const page = await fetchPage({ layer, bbox, startIndex, count: Math.min(pageSize, limit - written) });
    matched = Number(page.numberMatched ?? page.totalFeatures ?? page.features?.length ?? 0);
    for (const feature of page.features ?? []) {
      writer.write(`${JSON.stringify(normalizeBplanFeature(feature, layer, page.timeStamp))}\n`);
      written += 1;
      if (written >= limit) break;
    }
    if (!page.features?.length) break;
    startIndex += page.features.length;
    process.stderr.write(`Imported ${written} of ${Number.isFinite(matched) ? matched : "unknown"} B-Plans\r`);
  }
  await new Promise((done, reject) => { writer.end(done); writer.on("error", reject); });
  process.stderr.write(`\nWrote ${written} B-Plans to ${output}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
