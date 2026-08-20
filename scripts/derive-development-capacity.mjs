#!/usr/bin/env node
import { createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import polygonClipping from "polygon-clipping";

const option = (name, fallback = "") => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
async function* rows(filename) { const reader = createInterface({ input: createReadStream(resolve(filename)), crlfDelay: Infinity }); for await (const line of reader) if (line.trim()) yield JSON.parse(line); }
const CELL = 0.001;
const cell = (value) => Math.floor(value / CELL);
const cellsFor = (bbox) => { const values = []; for (let x = cell(bbox[0]); x <= cell(bbox[2]); x += 1) for (let y = cell(bbox[1]); y <= cell(bbox[3]); y += 1) values.push(`${x}:${y}`); return values; };
const overlaps = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const multiPolygon = (geometry) => geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
function ringArea(ring) { let total = 0; for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) total += ring[previous][0] * ring[index][1] - ring[index][0] * ring[previous][1]; return Math.abs(total) / 2; }
function polygonArea(polygons) { return polygons.reduce((sum, polygon) => sum + Math.max(0, ringArea(polygon[0]) - polygon.slice(1).reduce((holes, ring) => holes + ringArea(ring), 0)), 0); }

const locality = option("locality");
const borough = option("borough");
const parcels = [];
for await (const parcel of rows(option("parcels", "data/import/alkis-parcels-locality.ndjson"))) {
  if (locality && parcel.locality !== locality) continue;
  if (borough && parcel.borough !== borough) continue;
  parcels.push(parcel);
}
if (!parcels.length) throw new Error("No parcels matched the requested scope");
const scope = parcels.reduce((bbox, parcel) => [Math.min(bbox[0], parcel.bboxWest), Math.min(bbox[1], parcel.bboxSouth), Math.max(bbox[2], parcel.bboxEast), Math.max(bbox[3], parcel.bboxNorth)], [Infinity, Infinity, -Infinity, -Infinity]);

const index = new Map(); let indexedBuildings = 0;
for await (const row of rows(option("buildings", "data/import/alkis-buildings.ndjson"))) {
  if (!overlaps(scope, row.bbox)) continue;
  const geometry = multiPolygon(JSON.parse(row.geometryGeojson));
  const rawArea = polygonArea(geometry);
  if (!rawArea || !row.footprintSqm) continue;
  const building = { id: row.officialId, bbox: row.bbox, geometry, rawArea, footprintSqm: row.footprintSqm, storeys: row.aboveGroundStoreys };
  for (const key of cellsFor(row.bbox)) { const bucket = index.get(key) ?? []; bucket.push(building); index.set(key, bucket); }
  indexedBuildings += 1;
}

const output = createWriteStream(resolve(option("output", "data/import/parcel-development-capacity.ndjson")), { encoding: "utf8" });
let processed = 0, intersectionErrors = 0;
for (const parcel of parcels) {
  const parcelGeometry = multiPolygon(JSON.parse(parcel.geometryGeojson));
  const parcelBbox = [parcel.bboxWest, parcel.bboxSouth, parcel.bboxEast, parcel.bboxNorth];
  const candidates = new Map();
  for (const key of cellsFor(parcelBbox)) for (const building of index.get(key) ?? []) candidates.set(building.id, building);
  let footprintSqm = 0, knownStoreyFootprintSqm = 0, estimatedFloorAreaSqm = 0, observedStoreysMax = null, intersectingBuildings = 0;
  for (const building of candidates.values()) {
    if (!overlaps(parcelBbox, building.bbox)) continue;
    try {
      const intersection = polygonClipping.intersection(parcelGeometry, building.geometry);
      if (!intersection.length) continue;
      const overlapSqm = building.footprintSqm * Math.min(1, polygonArea(intersection) / building.rawArea);
      if (overlapSqm < 1) continue;
      intersectingBuildings += 1; footprintSqm += overlapSqm;
      if (Number.isFinite(building.storeys) && building.storeys > 0) {
        knownStoreyFootprintSqm += overlapSqm;
        estimatedFloorAreaSqm += overlapSqm * building.storeys;
        observedStoreysMax = Math.max(observedStoreysMax ?? 0, building.storeys);
      }
    } catch { intersectionErrors += 1; }
  }
  const storeyCoverage = footprintSqm ? knownStoreyFootprintSqm / footprintSqm : 1;
  const evidence = {
    method: "exact_alkis_building_parcel_polygon_intersection_v1", intersectingBuildings,
    observedFootprintSqm: Number(footprintSqm.toFixed(2)), estimatedFloorAreaSqm: Number(estimatedFloorAreaSqm.toFixed(2)),
    observedStoreysMax, storeyFootprintCoverage: Number(storeyCoverage.toFixed(4)),
    apparentGrz: parcel.areaSqm ? Number((footprintSqm / parcel.areaSqm).toFixed(4)) : null,
    apparentGfz: parcel.areaSqm && storeyCoverage >= 0.8 ? Number((estimatedFloorAreaSqm / parcel.areaSqm).toFixed(4)) : null,
    occupancyScreening: footprintSqm >= 1 ? "building_footprint_detected" : "no_building_footprint_detected",
    caveat: "Indicative physical-capacity screen. ALKIS footprint multiplied by recorded above-ground storeys is not the statutory GFZ calculation; legal definitions, ancillary structures and unrecorded or partial storeys may differ."
  };
  output.write(`${JSON.stringify({ parcelId: parcel.id, observationType: "development_capacity_screen", textValue: "Observed ALKIS building mass for legal-capacity comparison", extractionMethod: "exact_alkis_building_parcel_overlap_v1", confidence: footprintSqm === 0 || storeyCoverage >= 0.8 ? "medium" : "low", reviewStatus: "machine_checked", sourceKey: "berlin-alkis-buildings-wfs", sourceLocator: `exact polygon overlap with parcel ${parcel.id}`, evidence })}\n`);
  processed += 1; if (processed % 2000 === 0) process.stderr.write(`Derived ${processed} of ${parcels.length}\r`);
}
await new Promise((done, reject) => { output.end(done); output.on("error", reject); });
console.log(JSON.stringify({ parcels: parcels.length, indexedBuildings, intersectionErrors, locality: locality || null, borough: borough || null }));
