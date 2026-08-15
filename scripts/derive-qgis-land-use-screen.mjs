#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import polygonClipping from "polygon-clipping";
import { localD1Path } from "./local-d1-path.mjs";

const GPKG = resolve("data/import/lichterfelde_layers.gpkg");
const OUTPUT = resolve("data/import/lichterfelde-land-use-screen.sql");
const PUBLIC_OUTPUT = resolve("public/data/lichterfelde-land-use-screen.json");
const CELL_SIZE_M = 250;
const DOMINANT_SHARE = 0.5;
const SOURCE_KEY = "user-qgis-lichterfelde-land-use";
const SCREEN_METHOD = "qgis_exact_polygon_overlap_v1";
const sql = (value) => value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;

function readUInt32(buffer, offset, littleEndian) {
  return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
}

function readDouble(buffer, offset, littleEndian) {
  return littleEndian ? buffer.readDoubleLE(offset) : buffer.readDoubleBE(offset);
}

function readWkb(buffer, initialOffset) {
  let offset = initialOffset;
  const littleEndian = buffer[offset] === 1;
  offset += 1;
  const rawType = readUInt32(buffer, offset, littleEndian);
  offset += 4;
  const coordinateType = rawType & 0x0fffffff;
  const baseType = coordinateType % 1000;
  const dimensions = coordinateType >= 3000 ? 4 : coordinateType >= 1000 ? 3 : 2;
  if (rawType & 0x20000000) offset += 4;

  const point = () => {
    const values = [];
    for (let index = 0; index < dimensions; index += 1) {
      values.push(readDouble(buffer, offset, littleEndian));
      offset += 8;
    }
    return values.slice(0, 2);
  };
  const ring = () => {
    const count = readUInt32(buffer, offset, littleEndian);
    offset += 4;
    return Array.from({ length: count }, point);
  };

  if (baseType === 3) {
    const count = readUInt32(buffer, offset, littleEndian);
    offset += 4;
    return { geometry: { type: "Polygon", coordinates: Array.from({ length: count }, ring) }, offset };
  }
  if (baseType === 6) {
    const count = readUInt32(buffer, offset, littleEndian);
    offset += 4;
    const polygons = [];
    for (let index = 0; index < count; index += 1) {
      const parsed = readWkb(buffer, offset);
      offset = parsed.offset;
      if (parsed.geometry.type !== "Polygon") throw new Error("GeoPackage MultiPolygon contained a non-polygon member");
      polygons.push(parsed.geometry.coordinates);
    }
    return { geometry: { type: "MultiPolygon", coordinates: polygons }, offset };
  }
  throw new Error(`Unsupported WKB geometry type ${rawType}`);
}

function parseGeoPackageGeometry(hex) {
  const buffer = Buffer.from(hex, "hex");
  if (buffer.toString("ascii", 0, 2) !== "GP") throw new Error("Invalid GeoPackage geometry header");
  const flags = buffer[3];
  const envelopeCode = (flags >> 1) & 7;
  const envelopeDoubles = [0, 4, 6, 6, 8][envelopeCode];
  if (envelopeDoubles == null) throw new Error(`Unsupported GeoPackage envelope ${envelopeCode}`);
  return readWkb(buffer, 8 + envelopeDoubles * 8).geometry;
}

function multiPolygon(geometry) {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

function ringArea(ring) {
  let total = 0;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    total += ring[previous][0] * ring[index][1] - ring[index][0] * ring[previous][1];
  }
  return Math.abs(total) / 2;
}

function polygonArea(polygons) {
  return polygons.reduce((sum, polygon) => sum + Math.max(0, ringArea(polygon[0]) - polygon.slice(1).reduce((holes, ring) => holes + ringArea(ring), 0)), 0);
}

function geometryBbox(geometry) {
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const polygon of multiPolygon(geometry)) for (const ring of polygon) for (const [x, y] of ring) {
    if (x < bbox[0]) bbox[0] = x;
    if (y < bbox[1]) bbox[1] = y;
    if (x > bbox[2]) bbox[2] = x;
    if (y > bbox[3]) bbox[3] = y;
  }
  return bbox;
}

function overlaps(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function gridCells(bbox) {
  const result = [];
  for (let x = Math.floor(bbox[0] / CELL_SIZE_M); x <= Math.floor(bbox[2] / CELL_SIZE_M); x += 1) {
    for (let y = Math.floor(bbox[1] / CELL_SIZE_M); y <= Math.floor(bbox[3] / CELL_SIZE_M); y += 1) result.push(`${x}:${y}`);
  }
  return result;
}

async function queryLines(database, query, onRow) {
  const child = spawn("sqlite3", ["-batch", "-noheader", "-separator", "\t", database, query], { stdio: ["ignore", "pipe", "inherit"] });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  for await (const line of lines) if (line) await onRow(line.split("\t"));
  const status = await new Promise((done, reject) => {
    child.once("error", reject);
    child.once("close", done);
  });
  if (status !== 0) throw new Error(`sqlite3 query failed with status ${status}`);
}

async function loadLocalParcels(database) {
  const parcels = new Map();
  await queryLines(database, "SELECT id,area_sqm FROM parcels WHERE borough='Steglitz-Zehlendorf' AND locality='Lichterfelde'", ([id, area]) => {
    parcels.set(id, { id, areaSqm: Number(area) });
  });
  return parcels;
}

async function loadQgisParcels(localParcels) {
  const parcels = [];
  await queryLines(GPKG, "SELECT fsko,hex(geom),afl,uuid FROM 'Flurstücke_cropped'", ([id, geometryHex, sourceArea, uuid]) => {
    if (!localParcels.has(id)) return;
    const geometry = parseGeoPackageGeometry(geometryHex);
    const geometryArea = polygonArea(multiPolygon(geometry));
    parcels.push({
      id,
      uuid,
      geometry: multiPolygon(geometry),
      bbox: geometryBbox(geometry),
      areaSqm: localParcels.get(id).areaSqm,
      sourceAreaSqm: Number(sourceArea),
      geometryAreaSqm: geometryArea,
    });
  });
  return parcels;
}

async function loadLayer(table, scope) {
  const features = [];
  const rtree = `rtree_${table}_geom`;
  const query = `SELECT t.fid,hex(t.geom) FROM '${table}' t JOIN '${rtree}' r ON r.id=t.fid WHERE r.maxx>=${scope[0]} AND r.minx<=${scope[2]} AND r.maxy>=${scope[1]} AND r.miny<=${scope[3]}`;
  await queryLines(GPKG, query, ([id, geometryHex]) => {
    const geometry = parseGeoPackageGeometry(geometryHex);
    features.push({ id: `${table}:${id}`, geometry: multiPolygon(geometry), bbox: geometryBbox(geometry) });
  });
  return features;
}

function createIndex(features) {
  const index = new Map();
  for (const feature of features) for (const key of gridCells(feature.bbox)) {
    const bucket = index.get(key) ?? [];
    bucket.push(feature);
    index.set(key, bucket);
  }
  return index;
}

function candidates(index, bbox) {
  const unique = new Map();
  for (const key of gridCells(bbox)) for (const feature of index.get(key) ?? []) {
    if (overlaps(feature.bbox, bbox)) unique.set(feature.id, feature);
  }
  return [...unique.values()];
}

function overlapArea(parcelGeometry, parcelBbox, indexes) {
  const matches = new Map();
  for (const index of indexes) for (const feature of candidates(index, parcelBbox)) matches.set(feature.id, feature);
  if (!matches.size) return 0;
  try {
    const geometries = [...matches.values()].map((feature) => feature.geometry);
    const mask = geometries.length === 1 ? geometries[0] : polygonClipping.union(...geometries);
    return polygonArea(polygonClipping.intersection(parcelGeometry, mask));
  } catch {
    return 0;
  }
}

function roundedShare(area, parcelArea) {
  return Number(Math.max(0, Math.min(1, parcelArea ? area / parcelArea : 0)).toFixed(4));
}

const database = await localD1Path();
const localParcels = await loadLocalParcels(database);
const parcels = await loadQgisParcels(localParcels);
if (!parcels.length) throw new Error("No QGIS parcels matched the local Lichterfelde parcel IDs");
const scope = parcels.reduce((bbox, parcel) => [Math.min(bbox[0], parcel.bbox[0]), Math.min(bbox[1], parcel.bbox[1]), Math.max(bbox[2], parcel.bbox[2]), Math.max(bbox[3], parcel.bbox[3])], [Infinity, Infinity, -Infinity, -Infinity]);

const layerDefinitions = {
  street: ["Straßenraum_cropped"],
  park: ["Parkfläche_cropped", "Senat_Parkflaeche_25833"],
  publicSpace: ["Senat_Oeffentlicher_Platz_25833"],
  residential: ["Berlin_Wohnbauflaechen_25833"],
};
const indexes = {};
const featureCounts = {};
for (const [category, tables] of Object.entries(layerDefinitions)) {
  indexes[category] = [];
  for (const table of tables) {
    const features = await loadLayer(table, scope);
    featureCounts[table] = features.length;
    indexes[category].push(createIndex(features));
  }
}

await mkdir(dirname(OUTPUT), { recursive: true });
await mkdir(dirname(PUBLIC_OUTPUT), { recursive: true });
const writer = createWriteStream(OUTPUT, { encoding: "utf8" });
const publicWriter = createWriteStream(PUBLIC_OUTPUT, { encoding: "utf8" });
let firstPublicRecord = true;
const writePublicRecord = (id, evidence) => {
  const record = {
    id,
    parcelUseClass: evidence.parcelUseClass,
    vacancyEligible: evidence.vacancyEligible,
    streetOverlapShare: evidence.streetOverlapShare,
    parkOverlapShare: evidence.parkOverlapShare,
    publicSpaceOverlapShare: evidence.publicSpaceOverlapShare,
    residentialOverlapShare: evidence.residentialOverlapShare,
  };
  publicWriter.write(`${firstPublicRecord ? "" : ","}${JSON.stringify(record)}`);
  firstPublicRecord = false;
};
writer.write("PRAGMA foreign_keys=ON;\nBEGIN;\n");
publicWriter.write(`${JSON.stringify({ metadata: { source: "User-provided Lichterfelde QGIS GeoPackage", method: SCREEN_METHOD, dominantShareThreshold: DOMINANT_SHARE, crs: "EPSG:25833" } }).slice(0, -1)},"parcels":[`);
writer.write(`INSERT INTO sources(source_key,title,publisher,source_type,url,licence,retrieved_at,metadata_json) VALUES(${sql(SOURCE_KEY)},'Lichterfelde QGIS land-use layers','User-provided QGIS workspace','derived','local:data/import/lichterfelde_layers.gpkg',NULL,CURRENT_TIMESTAMP,${sql(JSON.stringify({ crs: "EPSG:25833", method: SCREEN_METHOD, dominantShare: DOMINANT_SHARE, layers: layerDefinitions }))}) ON CONFLICT(source_key) DO UPDATE SET retrieved_at=CURRENT_TIMESTAMP,metadata_json=excluded.metadata_json;\n`);
writer.write(`DELETE FROM parcel_planning_observations WHERE observation_type='land_use_eligibility_screen' AND parcel_id IN (SELECT id FROM parcels WHERE borough='Steglitz-Zehlendorf' AND locality='Lichterfelde');\n`);

const classCounts = { street: 0, park: 0, public_space: 0, residential_candidate: 0, other_or_review: 0 };
let geometryAreaMismatches = 0;
let processed = 0;
for (const parcel of parcels) {
  const streetShare = roundedShare(overlapArea(parcel.geometry, parcel.bbox, indexes.street), parcel.areaSqm);
  const parkShare = roundedShare(overlapArea(parcel.geometry, parcel.bbox, indexes.park), parcel.areaSqm);
  const publicSpaceShare = roundedShare(overlapArea(parcel.geometry, parcel.bbox, indexes.publicSpace), parcel.areaSqm);
  const residentialShare = roundedShare(overlapArea(parcel.geometry, parcel.bbox, indexes.residential), parcel.areaSqm);
  let parcelUseClass = "other_or_review";
  if (streetShare >= DOMINANT_SHARE) parcelUseClass = "street";
  else if (parkShare >= DOMINANT_SHARE) parcelUseClass = "park";
  else if (publicSpaceShare >= DOMINANT_SHARE) parcelUseClass = "public_space";
  else if (residentialShare >= DOMINANT_SHARE) parcelUseClass = "residential_candidate";
  const vacancyEligible = parcelUseClass === "residential_candidate";
  classCounts[parcelUseClass] += 1;
  if (Math.abs(parcel.geometryAreaSqm - parcel.areaSqm) > Math.max(5, parcel.areaSqm * 0.03)) geometryAreaMismatches += 1;
  const evidence = {
    method: SCREEN_METHOD,
    parcelUseClass,
    vacancyEligible,
    dominantShareThreshold: DOMINANT_SHARE,
    streetOverlapShare: streetShare,
    parkOverlapShare: parkShare,
    publicSpaceOverlapShare: publicSpaceShare,
    residentialOverlapShare: residentialShare,
    qgisParcelUuid: parcel.uuid,
    qgisSourceAreaSqm: parcel.sourceAreaSqm,
    caveat: "Deterministic screening from user-provided QGIS overlays. Residential candidate means eligible for vacancy screening, not proof of legal buildability.",
  };
  writer.write(`INSERT INTO parcel_planning_observations(parcel_id,observation_type,text_value,extraction_method,confidence,review_status,source_id,source_locator,evidence_json) VALUES(${sql(parcel.id)},'land_use_eligibility_screen',${sql(parcelUseClass)},${sql(SCREEN_METHOD)},'medium','machine_checked',(SELECT id FROM sources WHERE source_key=${sql(SOURCE_KEY)}),${sql(`QGIS exact overlap for ALKIS parcel ${parcel.id}`)},${sql(JSON.stringify(evidence))});\n`);
  writePublicRecord(parcel.id, evidence);
  processed += 1;
  if (processed % 1000 === 0) process.stderr.write(`Classified ${processed} of ${parcels.length}\r`);
}
const matchedIds = new Set(parcels.map((parcel) => parcel.id));
for (const parcel of localParcels.values()) {
  if (matchedIds.has(parcel.id)) continue;
  const evidence = {
    method: SCREEN_METHOD,
    parcelUseClass: "other_or_review",
    vacancyEligible: false,
    dominantShareThreshold: DOMINANT_SHARE,
    streetOverlapShare: 0,
    parkOverlapShare: 0,
    publicSpaceOverlapShare: 0,
    residentialOverlapShare: 0,
    qgisParcelMatch: false,
    caveat: "No matching parcel identifier was present in the supplied QGIS snapshot; the parcel is withheld from vacancy screening pending review.",
  };
  classCounts.other_or_review += 1;
  writer.write(`INSERT INTO parcel_planning_observations(parcel_id,observation_type,text_value,extraction_method,confidence,review_status,source_id,source_locator,evidence_json) VALUES(${sql(parcel.id)},'land_use_eligibility_screen','other_or_review',${sql(SCREEN_METHOD)},'low','unreviewed',(SELECT id FROM sources WHERE source_key=${sql(SOURCE_KEY)}),${sql(`No QGIS parcel match for ALKIS parcel ${parcel.id}`)},${sql(JSON.stringify(evidence))});\n`);
  writePublicRecord(parcel.id, evidence);
}
writer.write("COMMIT;\nPRAGMA optimize;\n");
publicWriter.write("]}");
await Promise.all([
  new Promise((done, reject) => { writer.end(done); writer.on("error", reject); }),
  new Promise((done, reject) => { publicWriter.end(done); publicWriter.on("error", reject); }),
]);

console.log(JSON.stringify({
  database,
  qgis: GPKG,
  output: OUTPUT,
  publicOutput: PUBLIC_OUTPUT,
  localParcels: localParcels.size,
  matchedParcels: parcels.length,
  missingQgisParcels: localParcels.size - parcels.length,
  geometryAreaMismatches,
  featureCounts,
  classCounts,
  thresholds: { dominantShare: DOMINANT_SHARE },
}, null, 2));
