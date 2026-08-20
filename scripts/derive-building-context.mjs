#!/usr/bin/env node

import { createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";

function option(name, fallback) { const p = `--${name}=`; return process.argv.find((v) => v.startsWith(p))?.slice(p.length) ?? fallback; }
async function* rows(path) { const reader = createInterface({ input: createReadStream(resolve(path)), crlfDelay: Infinity }); for await (const line of reader) if (line.trim()) yield JSON.parse(line); }
const CELL = 0.001;
function key(x, y) { return `${Math.floor(x / CELL)}:${Math.floor(y / CELL)}`; }
function distanceM(a, b) { const cos = Math.cos(a[1] * Math.PI / 180); return Math.hypot((a[0] - b[0]) * 111320 * cos, (a[1] - b[1]) * 110574); }
function pointInRing([x, y], ring) { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; }
function contains(point, geometry) { const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates; return polygons.some((p) => pointInRing(point, p[0]) && !p.slice(1).some((h) => pointInRing(point, h))); }
function median(values) { if (!values.length) return null; values.sort((a,b) => a-b); const i = Math.floor(values.length / 2); return values.length % 2 ? values[i] : (values[i-1] + values[i]) / 2; }
async function main() {
  const scope = option("scope", "all");
  const bplanCovered = new Set();
  if (scope === "section34-35") for await (const segment of rows(option("segments", "data/import/parcel-planning-segments.ndjson"))) bplanCovered.add(segment.parcelId);
  const index = new Map(); let buildingCount = 0;
  for await (const building of rows(option("buildings", "data/import/alkis-buildings.ndjson"))) {
    const point = [(building.bbox[0] + building.bbox[2]) / 2, (building.bbox[1] + building.bbox[3]) / 2];
    const k = key(...point), bucket = index.get(k) ?? []; bucket.push({ id: building.officialId, point, storeys: building.aboveGroundStoreys, footprintSqm: building.footprintSqm }); index.set(k, bucket); buildingCount += 1;
  }
  process.stderr.write(`Indexed ${buildingCount} building centres\n`);
  const output = createWriteStream(resolve(option("output", "data/import/parcel-building-context.ndjson")), { encoding: "utf8" });
  let processed = 0, written = 0;
  for await (const parcel of rows(option("parcels", "data/import/alkis-parcels-locality.ndjson"))) {
    if (scope === "section34-35" && (bplanCovered.has(parcel.id) || parcel.jurisdictionContext?.historicalSector !== "former_east_proxy")) continue;
    const centre = [parcel.centroidLng, parcel.centroidLat]; const cx = Math.floor(centre[0] / CELL), cy = Math.floor(centre[1] / CELL); const candidateMap = new Map();
    for (let x = cx - 2; x <= cx + 2; x += 1) for (let y = cy - 2; y <= cy + 2; y += 1) for (const building of index.get(`${x}:${y}`) ?? []) candidateMap.set(building.id, building);
    const bx0 = Math.floor(parcel.bboxWest / CELL), bx1 = Math.floor(parcel.bboxEast / CELL), by0 = Math.floor(parcel.bboxSouth / CELL), by1 = Math.floor(parcel.bboxNorth / CELL);
    for (let x = bx0; x <= bx1; x += 1) for (let y = by0; y <= by1; y += 1) for (const building of index.get(`${x}:${y}`) ?? []) candidateMap.set(building.id, building);
    const candidates = candidateMap.values();
    let within50m = 0, within100m = 0, nearest = Infinity; const storeys = []; let parcelBuildingCentres = 0, parcelFootprintSqm = 0;
    const geometry = JSON.parse(parcel.geometryGeojson);
    for (const building of candidates) { const d = distanceM(centre, building.point); nearest = Math.min(nearest, d); if (d <= 50) within50m += 1; if (d <= 100) { within100m += 1; if (building.storeys > 0) storeys.push(building.storeys); }
      if (building.point[0] >= parcel.bboxWest && building.point[0] <= parcel.bboxEast && building.point[1] >= parcel.bboxSouth && building.point[1] <= parcel.bboxNorth && contains(building.point, geometry)) { parcelBuildingCentres += 1; parcelFootprintSqm += building.footprintSqm ?? 0; } }
    const evidence = { radiusMethod: "building_bbox_centres", within50m, within100m, nearestBuildingDistanceM: Number.isFinite(nearest) ? nearest : null,
      medianObservedStoreys100m: median(storeys), observedStoreySampleSize: storeys.length, parcelBuildingCentres, parcelBuildingFootprintSqm: parcelFootprintSqm,
      occupancyScreening: parcelBuildingCentres > 0 ? "building_centre_detected" : "no_building_centre_detected",
      caveat: "Physical ALKIS building-centre screening only. A zero does not prove vacancy: a footprint may cross a parcel while its centre lies outside, or the source may omit a structure. Physical occupancy does not determine legal buildability." };
    output.write(`${JSON.stringify({ parcelId: parcel.id, observationType: "settlement_context", textValue: "ALKIS building-neighbourhood and occupancy metrics", extractionMethod: "official_building_centroid_metrics", confidence: parcelBuildingCentres > 0 ? "high" : "medium", reviewStatus: "machine_checked", sourceKey: "berlin-alkis-buildings-wfs", sourceLocator: "parcel geometry plus 100 m neighbourhood around parcel centroid", evidence })}\n`);
    written += 1; processed += 1; if (processed % 25000 === 0) process.stderr.write(`Derived ${processed} settlement contexts\r`);
  }
  await new Promise((done, reject) => { output.end(done); output.on("error", reject); }); process.stderr.write(`\nWrote ${written} settlement-context observations\n`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
