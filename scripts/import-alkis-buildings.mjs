#!/usr/bin/env node

import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const WFS_URL = "https://gdi.berlin.de/services/wfs/alkis_gebaeude";
const TYPE_NAME = "alkis_gebaeude:gebaeude";
function option(name, fallback) { const p = `--${name}=`; return process.argv.find((v) => v.startsWith(p))?.slice(p.length) ?? fallback; }
function positive(value, name) { const n = Number(value); if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`); return n; }
function visit(c, fn) { if (typeof c?.[0] === "number") return fn(c[0], c[1]); for (const x of c ?? []) visit(x, fn); }
function bboxOf(geometry) { const b = [Infinity, Infinity, -Infinity, -Infinity]; visit(geometry.coordinates, (x, y) => { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); }); return b; }
export function normalizeBuilding(feature, collectionTimestamp) {
  const p = feature.properties ?? {}; const geometry = feature.geometry;
  if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) throw new Error("Unsupported building geometry");
  if (!p.uuid) throw new Error("Building misses uuid");
  return { officialId: String(p.uuid), functionCode: p.gfk == null ? null : String(p.gfk), functionLabel: p.bezgfk || null,
    aboveGroundStoreys: p.aog !== null && p.aog !== "" && Number.isFinite(Number(p.aog)) ? Number(p.aog) : null,
    belowGroundStoreys: p.aug !== null && p.aug !== "" && Number.isFinite(Number(p.aug)) ? Number(p.aug) : null,
    heightM: p.hoh !== null && p.hoh !== "" && Number.isFinite(Number(p.hoh)) ? Number(p.hoh) : null,
    address: p.namlag || null, footprintSqm: Number.isFinite(Number(p.shape_area)) ? Number(p.shape_area) : null,
    geometryGeojson: JSON.stringify(geometry), bbox: feature.bbox ?? bboxOf(geometry), sourceUpdatedAt: collectionTimestamp ?? null };
}
async function fetchPage(startIndex, count) {
  const url = new URL(WFS_URL); url.search = new URLSearchParams({ service: "WFS", version: "2.0.0", request: "GetFeature",
    typeNames: TYPE_NAME, outputFormat: "application/json", srsName: "EPSG:4326", startIndex: String(startIndex), count: String(count),
    propertyName: "uuid,gfk,bezgfk,aog,aug,hoh,namlag,shape_area,geom" }).toString();
  const response = await fetch(url, { headers: { "user-agent": "Grounded-Berlin-building-context-import/1.0" } });
  if (!response.ok) throw new Error(`ALKIS building WFS returned ${response.status}`); return response.json();
}
async function main() {
  const output = resolve(option("output", "data/import/alkis-buildings.ndjson")); const pageSize = positive(option("page-size", "5000"), "page-size");
  const maxPages = option("max-pages", null) == null ? Infinity : positive(option("max-pages", "1"), "max-pages");
  await mkdir(dirname(output), { recursive: true }); const writer = createWriteStream(output, { encoding: "utf8" });
  let start = 0, matched = Infinity, pages = 0;
  while (start < matched && pages < maxPages) { const page = await fetchPage(start, pageSize); matched = Number(page.numberMatched ?? page.totalFeatures ?? 0); pages += 1;
    for (const feature of page.features ?? []) writer.write(`${JSON.stringify(normalizeBuilding(feature, page.timeStamp))}\n`);
    if (!page.features?.length) break; start += page.features.length; process.stderr.write(`Imported ${start} of ${matched} buildings\r`); }
  await new Promise((done, reject) => { writer.end(done); writer.on("error", reject); }); process.stderr.write(`\nWrote ${start} buildings to ${output}\n`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
