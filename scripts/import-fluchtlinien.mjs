#!/usr/bin/env node

import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const WFS_URL = "https://gdi.berlin.de/services/wfs/fluchtlinien";
const TYPE_NAME = "fluchtlinien:fluchtlinien";

function option(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}
function positiveInteger(value, name) {
  const result = Number(value);
  if (!Number.isInteger(result) || result <= 0) throw new Error(`${name} must be a positive integer`);
  return result;
}
function visitCoordinates(coordinates, visit) {
  if (typeof coordinates?.[0] === "number") return visit(coordinates[0], coordinates[1]);
  for (const child of coordinates ?? []) visitCoordinates(child, visit);
}
function geometryBbox(geometry) {
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  visitCoordinates(geometry.coordinates, (x, y) => {
    bbox[0] = Math.min(bbox[0], x); bbox[1] = Math.min(bbox[1], y);
    bbox[2] = Math.max(bbox[2], x); bbox[3] = Math.max(bbox[3], y);
  });
  return bbox;
}
function lineType(value = "") {
  const text = value.toLocaleLowerCase("de-DE");
  if (text.includes("straßen- und bau")) return "street_and_building_line";
  if (text.includes("bauflucht")) return "building_line";
  if (text.includes("straßenflucht")) return "street_line";
  if (text.includes("freiflächen")) return "open_space_boundary";
  return "other";
}
export function normalizeFluchtlinie(feature, collectionTimestamp) {
  const properties = feature.properties ?? {};
  const geometry = feature.geometry;
  if (!geometry || !["LineString", "MultiLineString"].includes(geometry.type)) {
    throw new Error(`Unsupported Fluchtlinie geometry ${feature.id ?? "unknown"}`);
  }
  const officialId = String(properties.uid ?? feature.id ?? "").trim();
  if (!officialId || !properties.typ || !properties.bezirk) throw new Error("Fluchtlinie misses required attributes");
  return {
    officialId,
    lineType: lineType(properties.typ),
    officialLineType: String(properties.typ),
    approvalKind: properties.a_text ? String(properties.a_text) : null,
    approvalDate: properties.a_datum ?? null,
    approvalDateEnd: properties.a_datum2 ?? null,
    borough: String(properties.bezirk),
    geometryGeojson: JSON.stringify(geometry),
    bbox: feature.bbox ?? geometryBbox(geometry),
    sourceUpdatedAt: properties.datum ?? collectionTimestamp ?? null,
  };
}

async function fetchPage(startIndex, count) {
  const url = new URL(WFS_URL);
  url.search = new URLSearchParams({ service: "WFS", version: "2.0.0", request: "GetFeature",
    typeNames: TYPE_NAME, outputFormat: "application/json", srsName: "EPSG:4326",
    startIndex: String(startIndex), count: String(count) }).toString();
  const response = await fetch(url, { headers: { "user-agent": "Grounded-Berlin-fluchtlinien-import/1.0" } });
  if (!response.ok) throw new Error(`Fluchtlinien WFS returned ${response.status}`);
  return response.json();
}
async function main() {
  const output = resolve(option("output", "data/import/fluchtlinien.ndjson"));
  const pageSize = positiveInteger(option("page-size", "1000"), "page-size");
  await mkdir(dirname(output), { recursive: true });
  const writer = createWriteStream(output, { encoding: "utf8" });
  let startIndex = 0;
  let matched = Infinity;
  while (startIndex < matched) {
    const page = await fetchPage(startIndex, pageSize);
    matched = Number(page.numberMatched ?? page.totalFeatures ?? page.features?.length ?? 0);
    for (const feature of page.features ?? []) writer.write(`${JSON.stringify(normalizeFluchtlinie(feature, page.timeStamp))}\n`);
    if (!page.features?.length) break;
    startIndex += page.features.length;
    process.stderr.write(`Imported ${startIndex} of ${matched} Fluchtlinien\r`);
  }
  await new Promise((done, reject) => { writer.end(done); writer.on("error", reject); });
  process.stderr.write(`\nWrote ${startIndex} Fluchtlinien to ${output}\n`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
