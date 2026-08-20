#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import polygonClipping from "polygon-clipping";

const option = (name, fallback = "") => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
async function* rows(filename) {
  const reader = createInterface({ input: createReadStream(resolve(filename)), crlfDelay: Infinity });
  for await (const line of reader) if (line.trim()) yield JSON.parse(line);
}
const CELL = 0.001;
const cell = (value) => Math.floor(value / CELL);
const cellsFor = (bbox) => {
  const values = [];
  for (let x = cell(bbox[0]); x <= cell(bbox[2]); x += 1)
    for (let y = cell(bbox[1]); y <= cell(bbox[3]); y += 1) values.push(`${x}:${y}`);
  return values;
};
const overlaps = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const multiPolygon = (geometry) => geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;

const locality = option("locality", "Lichterfelde");
const borough = option("borough", "Steglitz-Zehlendorf");
const parcelIndex = new Map();
let parcelCount = 0;
let scope = [Infinity, Infinity, -Infinity, -Infinity];
for await (const row of rows(option("parcels", "data/import/alkis-parcels-locality.ndjson"))) {
  if (row.locality !== locality || row.borough !== borough) continue;
  const parcel = {
    bbox: [row.bboxWest, row.bboxSouth, row.bboxEast, row.bboxNorth],
    geometry: multiPolygon(JSON.parse(row.geometryGeojson)),
  };
  scope = [Math.min(scope[0], parcel.bbox[0]), Math.min(scope[1], parcel.bbox[1]), Math.max(scope[2], parcel.bbox[2]), Math.max(scope[3], parcel.bbox[3])];
  for (const key of cellsFor(parcel.bbox)) {
    const bucket = parcelIndex.get(key) ?? [];
    bucket.push(parcel);
    parcelIndex.set(key, bucket);
  }
  parcelCount += 1;
}
if (!parcelCount) throw new Error(`No parcels found for ${locality}, ${borough}`);

const features = [];
let sourceUpdatedAt = null;
let candidates = 0;
let intersectionErrors = 0;
for await (const row of rows(option("buildings", "data/import/alkis-buildings.ndjson"))) {
  if (!overlaps(scope, row.bbox)) continue;
  candidates += 1;
  const candidateParcels = new Set();
  for (const key of cellsFor(row.bbox)) for (const parcel of parcelIndex.get(key) ?? []) candidateParcels.add(parcel);
  const geometry = JSON.parse(row.geometryGeojson);
  const buildingPolygon = multiPolygon(geometry);
  let inLocality = false;
  for (const parcel of candidateParcels) {
    if (!overlaps(row.bbox, parcel.bbox)) continue;
    try {
      if (polygonClipping.intersection(parcel.geometry, buildingPolygon).length) { inLocality = true; break; }
    } catch { intersectionErrors += 1; }
  }
  if (!inLocality) continue;
  if (row.sourceUpdatedAt && (!sourceUpdatedAt || row.sourceUpdatedAt > sourceUpdatedAt)) sourceUpdatedAt = row.sourceUpdatedAt;
  features.push({
    type: "Feature",
    id: row.officialId,
    properties: {
      storeys: row.aboveGroundStoreys ?? null,
      function: row.functionLabel ?? null,
      address: row.address ?? null,
    },
    geometry,
  });
}

const output = resolve(option("output", "public/data/lichterfelde-alkis-buildings.geojson"));
await writeFile(output, JSON.stringify({
  type: "FeatureCollection",
  name: `${locality} ALKIS buildings`,
  metadata: {
    borough, locality, parcelCount, buildingCount: features.length, candidateBuildings: candidates,
    sourceTitle: "ALKIS Gebäude Berlin",
    sourceUrl: "https://gdi.berlin.de/services/wfs/alkis_gebaeude",
    sourceUpdatedAt,
    extractionMethod: "exact_building_parcel_polygon_intersection",
    intersectionErrors,
  },
  features,
}));
console.log(JSON.stringify({ output, parcelCount, buildings: features.length, candidates, intersectionErrors, sourceUpdatedAt }));
