#!/usr/bin/env node

import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const WFS_URL = "https://gdi.berlin.de/services/wfs/alkis_flurstuecke";
const TYPE_NAME = "alkis_flurstuecke:flurstuecke";

function option(name, fallback) {
  const prefix = `--${name}=`;
  const match = process.argv.find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function asPositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function validateBbox(value) {
  if (!value) return null;
  const parts = value.split(",").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error("bbox must be west,south,east,north in EPSG:4326");
  }
  const [west, south, east, north] = parts;
  if (west >= east || south >= north) throw new Error("bbox bounds are invalid");
  return parts;
}

function visitCoordinates(coordinates, visit) {
  if (typeof coordinates?.[0] === "number") {
    visit(coordinates[0], coordinates[1]);
    return;
  }
  for (const child of coordinates ?? []) visitCoordinates(child, visit);
}

function geometryBbox(geometry) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  visitCoordinates(geometry.coordinates, (x, y) => {
    west = Math.min(west, x);
    south = Math.min(south, y);
    east = Math.max(east, x);
    north = Math.max(north, y);
  });
  if (![west, south, east, north].every(Number.isFinite)) {
    throw new Error("Feature has no usable geometry coordinates");
  }
  return [west, south, east, north];
}

function ringCentroid(ring) {
  if (ring.length < 4) return null;
  // Work in local coordinates. The subtraction avoids catastrophic
  // cancellation for tiny cadastral slivers expressed as lon/lat values.
  const [originX, originY] = ring[0];
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const x1 = ring[i][0] - originX;
    const y1 = ring[i][1] - originY;
    const x2 = ring[i + 1][0] - originX;
    const y2 = ring[i + 1][1] - originY;
    const cross = x1 * y2 - x2 * y1;
    twiceArea += cross;
    x += (x1 + x2) * cross;
    y += (y1 + y2) * cross;
  }
  if (Math.abs(twiceArea) < Number.EPSILON) return null;
  return {
    area: twiceArea / 2,
    x: originX + x / (3 * twiceArea),
    y: originY + y / (3 * twiceArea),
  };
}

function geometryCentroid(geometry, bbox) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let weightedX = 0;
  let weightedY = 0;
  let weight = 0;
  for (const polygon of polygons ?? []) {
    const exterior = ringCentroid(polygon[0] ?? []);
    if (!exterior) continue;
    const polygonWeight = Math.abs(exterior.area);
    weightedX += exterior.x * polygonWeight;
    weightedY += exterior.y * polygonWeight;
    weight += polygonWeight;
  }
  const bboxCentre = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
  if (weight <= 0) return bboxCentre;
  const centroid = [weightedX / weight, weightedY / weight];
  return centroid[0] >= bbox[0] && centroid[0] <= bbox[2]
    && centroid[1] >= bbox[1] && centroid[1] <= bbox[3]
    ? centroid
    : bboxCentre;
}

export function normalizeFeature(feature, collectionTimestamp) {
  const properties = feature.properties ?? {};
  const geometry = feature.geometry;
  if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) {
    throw new Error(`Unsupported geometry for ${feature.id ?? "unknown feature"}`);
  }
  const bbox = feature.bbox ?? geometryBbox(geometry);
  const centroid = geometryCentroid(geometry, bbox);
  if (!properties.fsko || !properties.uuid || !Number.isFinite(Number(properties.afl))) {
    throw new Error(`Missing required ALKIS attributes for ${feature.id ?? "unknown feature"}`);
  }

  return {
    id: String(properties.fsko),
    alkisUuid: String(properties.uuid),
    numerator: String(properties.zae ?? ""),
    denominator: properties.nen ? String(properties.nen) : null,
    cadastralDistrictCode: String(properties.gmk ?? ""),
    cadastralDistrict: String(properties.namgmk ?? ""),
    flur: String(properties.fln ?? ""),
    borough: String(properties.namgem ?? ""),
    locality: null,
    areaSqm: Number(properties.afl),
    centroidLng: centroid[0],
    centroidLat: centroid[1],
    bboxWest: bbox[0],
    bboxSouth: bbox[1],
    bboxEast: bbox[2],
    bboxNorth: bbox[3],
    geometryGeojson: JSON.stringify(geometry),
    sourceFeatureTimestamp: properties.beg ?? properties.zde ?? collectionTimestamp ?? null,
  };
}

async function fetchPage({ startIndex, count, bbox }) {
  const url = new URL(WFS_URL);
  url.search = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: TYPE_NAME,
    outputFormat: "application/json",
    srsName: "EPSG:4326",
    startIndex: String(startIndex),
    count: String(count),
    ...(bbox ? { bbox: `${bbox.join(",")},EPSG:4326` } : {}),
  }).toString();

  const response = await fetch(url, { headers: { "user-agent": "Grounded-Berlin-parcel-import/1.0" } });
  if (!response.ok) throw new Error(`ALKIS WFS returned ${response.status} ${response.statusText}`);
  return response.json();
}

async function main() {
  const output = resolve(option("output", "data/import/alkis-parcels.ndjson"));
  const pageSize = asPositiveInteger(option("page-size", "1000"), "page-size");
  const limitValue = option("limit", "");
  const limit = limitValue ? asPositiveInteger(limitValue, "limit") : Infinity;
  const bbox = validateBbox(option("bbox", ""));

  await mkdir(dirname(output), { recursive: true });
  const stream = createWriteStream(output, { encoding: "utf8" });
  let startIndex = 0;
  let written = 0;
  let matched = Infinity;

  while (startIndex < matched && written < limit) {
    const count = Math.min(pageSize, limit - written);
    const page = await fetchPage({ startIndex, count, bbox });
    matched = Number(page.numberMatched ?? page.totalFeatures ?? page.features.length);
    for (const feature of page.features ?? []) {
      stream.write(`${JSON.stringify(normalizeFeature(feature, page.timeStamp))}\n`);
      written += 1;
      if (written >= limit) break;
    }
    if (!page.features?.length) break;
    startIndex += page.features.length;
    process.stderr.write(`Imported ${written} of ${Number.isFinite(matched) ? matched : "unknown"} parcels\r`);
  }

  await new Promise((resolveDone, reject) => {
    stream.end(resolveDone);
    stream.on("error", reject);
  });
  process.stderr.write(`\nWrote ${written} parcels to ${output}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
