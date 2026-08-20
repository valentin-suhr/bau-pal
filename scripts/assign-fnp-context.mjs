#!/usr/bin/env node

import { createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";

function option(name, fallback) { const p = `--${name}=`; return process.argv.find((v) => v.startsWith(p))?.slice(p.length) ?? fallback; }
async function rows(path) { const result = []; const input = createInterface({ input: createReadStream(resolve(path)), crlfDelay: Infinity }); for await (const line of input) if (line.trim()) result.push(JSON.parse(line)); return result; }
function pointInRing([x, y], ring) { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; }
function contains(point, geometry) { const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates; return polygons.some((polygon) => pointInRing(point, polygon[0]) && !polygon.slice(1).some((hole) => pointInRing(point, hole))); }
const CELL = 0.02;
const key = (x, y) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;

async function main() {
  const features = (await rows(option("fnp", "data/import/fnp-land-use.ndjson"))).map((r) => ({ ...r, geometry: JSON.parse(r.geometryGeojson) }));
  const grid = new Map();
  for (const feature of features) {
    for (let ix = Math.floor(feature.bbox[0] / CELL); ix <= Math.floor(feature.bbox[2] / CELL); ix++) for (let iy = Math.floor(feature.bbox[1] / CELL); iy <= Math.floor(feature.bbox[3] / CELL); iy++) {
      const cell = `${ix},${iy}`; if (!grid.has(cell)) grid.set(cell, []); grid.get(cell).push(feature);
    }
  }
  const input = createInterface({ input: createReadStream(resolve(option("parcels", "data/import/alkis-parcels-locality.ndjson"))), crlfDelay: Infinity });
  const output = createWriteStream(resolve(option("output", "data/import/parcel-fnp-context.ndjson")), { encoding: "utf8" });
  let processed = 0, assigned = 0, ambiguous = 0;
  for await (const line of input) {
    if (!line.trim()) continue;
    const parcel = JSON.parse(line); const point = [parcel.centroidLng, parcel.centroidLat];
    const matches = (grid.get(key(...point)) ?? []).filter((feature) => point[0] >= feature.bbox[0] && point[0] <= feature.bbox[2] && point[1] >= feature.bbox[1] && point[1] <= feature.bbox[3] && contains(point, feature.geometry));
    const match = matches[0] ?? null;
    output.write(`${JSON.stringify({ parcelId: parcel.id, landUse: match?.landUse ?? null, purpose: match?.purpose ?? null, officialId: match?.officialId ?? null, objectCode: match?.objectCode ?? null, objectNumber: match?.objectNumber ?? null, sourceUpdatedAt: match?.sourceUpdatedAt ?? null, matchCount: matches.length, confidence: matches.length === 1 ? "medium" : matches.length > 1 ? "low" : "unknown", extractionMethod: "official_fnp_centroid_overlay_v1" })}\n`);
    processed += 1; if (match) assigned += 1; if (matches.length > 1) ambiguous += 1;
    if (processed % 50000 === 0) process.stderr.write(`Processed ${processed}; assigned ${assigned}; ambiguous ${ambiguous}\r`);
  }
  await new Promise((done, reject) => { output.end(done); output.on("error", reject); });
  process.stderr.write(`\nAssigned ${assigned} of ${processed} parcel centroids; ${ambiguous} ambiguous\n`);
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
