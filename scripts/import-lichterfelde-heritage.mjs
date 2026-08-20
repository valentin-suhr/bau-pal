#!/usr/bin/env node
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import polygonClipping from "polygon-clipping";

const WFS_URL = "https://gdi.berlin.de/services/wfs/denkmale";
const SOURCE_URL = "https://daten.berlin.de/datensaetze/denkmale-wfs-12f0f9ed";
const locality = "Lichterfelde";
const borough = "Steglitz-Zehlendorf";
const NEARBY_M = 50;
const CELL = 0.002;
const sql = (value) => value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
const multiPolygon = (geometry) => geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
const overlaps = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const cell = (value) => Math.floor(value / CELL);
const cellsFor = (bbox) => { const out = []; for (let x = cell(bbox[0]); x <= cell(bbox[2]); x++) for (let y = cell(bbox[1]); y <= cell(bbox[3]); y++) out.push(`${x}:${y}`); return out; };
const expanded = (bbox, metres) => { const lat = (bbox[1] + bbox[3]) / 2; const dy = metres / 111320; const dx = metres / (111320 * Math.cos(lat * Math.PI / 180)); return [bbox[0] - dx, bbox[1] - dy, bbox[2] + dx, bbox[3] + dy]; };
async function* rows(filename) { const reader = createInterface({ input: createReadStream(resolve(filename)), crlfDelay: Infinity }); for await (const line of reader) if (line.trim()) yield JSON.parse(line); }
function rings(geometry) { return multiPolygon(geometry).flatMap((polygon) => polygon); }
function segmentDistance(point, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1]; const length2 = dx * dx + dy * dy; const t = length2 ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2)) : 0; return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy)); }
function geometryDistanceM(a, b, latitude) {
  const sx = 111320 * Math.cos(latitude * Math.PI / 180), sy = 111320;
  const ar = rings(a).map((ring) => ring.map(([x, y]) => [x * sx, y * sy]));
  const br = rings(b).map((ring) => ring.map(([x, y]) => [x * sx, y * sy]));
  let minimum = Infinity;
  for (const one of ar) for (const two of br) {
    for (const point of one) for (let index = 1; index < two.length; index++) minimum = Math.min(minimum, segmentDistance(point, two[index - 1], two[index]));
    for (const point of two) for (let index = 1; index < one.length; index++) minimum = Math.min(minimum, segmentDistance(point, one[index - 1], one[index]));
  }
  return minimum;
}

const parcels = [];
let scope = [Infinity, Infinity, -Infinity, -Infinity];
for await (const row of rows("data/import/alkis-parcels-locality.ndjson")) {
  if (row.locality !== locality || row.borough !== borough) continue;
  const bbox = [row.bboxWest, row.bboxSouth, row.bboxEast, row.bboxNorth];
  parcels.push({ id: row.id, bbox, geometry: JSON.parse(row.geometryGeojson) });
  scope = [Math.min(scope[0], bbox[0]), Math.min(scope[1], bbox[1]), Math.max(scope[2], bbox[2]), Math.max(scope[3], bbox[3])];
}
if (!parcels.length) throw new Error("No Lichterfelde parcels found");

const requestUrl = new URL(WFS_URL);
requestUrl.search = new URLSearchParams({ service: "WFS", version: "2.0.0", request: "GetFeature", typeNames: "denkmale:denkmale", outputFormat: "application/json", srsName: "EPSG:4326", bbox: `${expanded(scope, NEARBY_M).join(",")},EPSG:4326` }).toString();
const response = await fetch(requestUrl, { headers: { "user-agent": "Grounded-Lichterfelde-heritage-overlay/1.0" } });
if (!response.ok) throw new Error(`Denkmale WFS returned ${response.status}`);
const collection = await response.json();
const features = (collection.features ?? []).filter((feature) => feature.geometry && ["Polygon", "MultiPolygon"].includes(feature.geometry.type)).map((feature) => ({
  officialId: String(feature.properties?.id ?? feature.id), gisId: String(feature.properties?.gisid ?? feature.id),
  type: String(feature.properties?.typ ?? "Unclassified monument"), detailUrl: feature.properties?.link ?? null,
  geometry: feature.geometry, bbox: feature.bbox,
}));
const featureIndex = new Map();
for (const feature of features) for (const key of cellsFor(expanded(feature.bbox, NEARBY_M))) { const bucket = featureIndex.get(key) ?? []; bucket.push(feature); featureIndex.set(key, bucket); }

const matchedFeatures = new Map(); const relations = []; let intersectionErrors = 0;
for (const parcel of parcels) {
  const candidates = new Map();
  for (const key of cellsFor(parcel.bbox)) for (const feature of featureIndex.get(key) ?? []) candidates.set(feature.officialId, feature);
  for (const feature of candidates.values()) {
    if (!overlaps(expanded(feature.bbox, NEARBY_M), parcel.bbox)) continue;
    let direct = false;
    try { direct = polygonClipping.intersection(multiPolygon(parcel.geometry), multiPolygon(feature.geometry)).length > 0; } catch { intersectionErrors++; }
    const distance = direct ? 0 : geometryDistanceM(parcel.geometry, feature.geometry, (parcel.bbox[1] + parcel.bbox[3]) / 2);
    if (!direct && distance > NEARBY_M) continue;
    matchedFeatures.set(feature.officialId, feature);
    relations.push({ parcelId: parcel.id, heritageId: feature.officialId, relation: direct ? "direct_overlap" : "nearby_50m", distance });
  }
}

const output = resolve("data/import/lichterfelde-heritage.sql"); await mkdir(dirname(output), { recursive: true });
const writer = createWriteStream(output, { encoding: "utf8" });
writer.write("PRAGMA foreign_keys=ON;\nBEGIN;\n");
writer.write(`INSERT INTO sources(source_key,title,publisher,source_type,url,licence,effective_from,retrieved_at,metadata_json) VALUES('berlin-denkmale-wfs','Denkmale Berlin','Landesdenkmalamt Berlin','wfs',${sql(SOURCE_URL)},'dl-de-zero-2.0','2026-06-11',${sql(collection.timeStamp)},'${JSON.stringify({ scope: `${locality}, ${borough}`, relationMethod: "exact overlap plus 50 metre geometry distance" })}') ON CONFLICT(source_key) DO UPDATE SET retrieved_at=excluded.retrieved_at,metadata_json=excluded.metadata_json;\n`);
writer.write("DELETE FROM parcel_heritage_constraints WHERE parcel_id IN (SELECT id FROM parcels WHERE borough='Steglitz-Zehlendorf' AND locality='Lichterfelde');\n");
for (const feature of matchedFeatures.values()) writer.write(`INSERT INTO heritage_features(official_id,gis_id,monument_type,detail_url,geometry_geojson,bbox_west,bbox_south,bbox_east,bbox_north,source_id,source_updated_at) VALUES(${sql(feature.officialId)},${sql(feature.gisId)},${sql(feature.type)},${sql(feature.detailUrl)},${sql(JSON.stringify(feature.geometry))},${feature.bbox[0]},${feature.bbox[1]},${feature.bbox[2]},${feature.bbox[3]},(SELECT id FROM sources WHERE source_key='berlin-denkmale-wfs'),${sql(collection.timeStamp)}) ON CONFLICT(official_id) DO UPDATE SET monument_type=excluded.monument_type,detail_url=excluded.detail_url,geometry_geojson=excluded.geometry_geojson,source_updated_at=excluded.source_updated_at;\n`);
for (const relation of relations) writer.write(`INSERT INTO parcel_heritage_constraints(parcel_id,heritage_id,relation,distance_m) VALUES(${sql(relation.parcelId)},${sql(relation.heritageId)},${sql(relation.relation)},${relation.distance.toFixed(2)});\n`);
writer.write("COMMIT;\nPRAGMA optimize;\n");
await new Promise((done, reject) => { writer.end(done); writer.on("error", reject); });
console.log(JSON.stringify({ parcels: parcels.length, downloadedFeatures: features.length, matchedFeatures: matchedFeatures.size, relations: relations.length, direct: relations.filter((row) => row.relation === "direct_overlap").length, nearby: relations.filter((row) => row.relation === "nearby_50m").length, intersectionErrors, sourceUpdatedAt: collection.timeStamp, output }));
