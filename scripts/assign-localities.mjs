#!/usr/bin/env node

import { createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";

function option(name, fallback) { const p = `--${name}=`; return process.argv.find((v) => v.startsWith(p))?.slice(p.length) ?? fallback; }
async function readRows(path) { const rows = []; const r = createInterface({ input: createReadStream(resolve(path)), crlfDelay: Infinity }); for await (const l of r) if (l.trim()) rows.push(JSON.parse(l)); return rows; }
function pointInRing([x, y], ring) { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; }
function contains(point, geometry) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some((polygon) => pointInRing(point, polygon[0]) && !polygon.slice(1).some((hole) => pointInRing(point, hole)));
}
const WEST = new Set(["Charlottenburg-Wilmersdorf", "Neukölln", "Reinickendorf", "Spandau", "Steglitz-Zehlendorf", "Tempelhof-Schöneberg"]);
const EAST = new Set(["Lichtenberg", "Marzahn-Hellersdorf", "Pankow", "Treptow-Köpenick"]);
function historicalSector(borough, locality) {
  if (WEST.has(borough)) return "former_west_proxy";
  if (EAST.has(borough)) return "former_east_proxy";
  if (borough === "Friedrichshain-Kreuzberg") return locality === "Kreuzberg" ? "former_west_proxy" : "former_east_proxy";
  if (borough === "Mitte") return ["Tiergarten", "Hansaviertel", "Moabit", "Wedding", "Gesundbrunnen"].includes(locality) ? "former_west_proxy" : "former_east_proxy";
  return "unknown";
}
export { historicalSector };
async function main() {
  const localities = (await readRows(option("localities", "data/import/ortsteile.ndjson"))).map((row) => ({ ...row, geometry: JSON.parse(row.geometryGeojson) }));
  const input = createInterface({ input: createReadStream(resolve(option("parcels", "data/import/alkis-parcels.ndjson"))), crlfDelay: Infinity });
  const writer = createWriteStream(resolve(option("output", "data/import/alkis-parcels-locality.ndjson")), { encoding: "utf8" });
  let processed = 0, assigned = 0;
  for await (const line of input) {
    if (!line.trim()) continue;
    const parcel = JSON.parse(line); const point = [parcel.centroidLng, parcel.centroidLat];
    const match = localities.find((area) => point[0] >= area.bbox[0] && point[0] <= area.bbox[2] && point[1] >= area.bbox[1] && point[1] <= area.bbox[3] && contains(point, area.geometry));
    const locality = match?.name ?? null;
    writer.write(`${JSON.stringify({ ...parcel, locality, jurisdictionContext: { historicalSector: historicalSector(parcel.borough, locality), assignmentMethod: "official_ortsteil_centroid_proxy", confidence: match ? "medium" : "unknown", sourceKey: "berlin-alkis-ortsteile-wfs" } })}\n`);
    processed += 1; if (match) assigned += 1;
    if (processed % 50000 === 0) process.stderr.write(`Processed ${processed}; locality ${assigned}\r`);
  }
  await new Promise((done, reject) => { writer.end(done); writer.on("error", reject); });
  process.stderr.write(`\nAssigned ${assigned} of ${processed} parcel centroids to an Ortsteil\n`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
