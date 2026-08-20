#!/usr/bin/env node

import { createReadStream, createWriteStream } from "node:fs";
import { readFile, mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import polygonClipping from "polygon-clipping";

function option(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

async function* iterateNdjson(path) {
  const input = createInterface({ input: createReadStream(resolve(path)), crlfDelay: Infinity });
  for await (const line of input) if (line.trim()) yield JSON.parse(line);
}

function multiPolygon(geometry) {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

function bboxOverlaps(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function ringAreaSqm(ring) {
  if (ring.length < 4) return 0;
  const meanLat = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
  const metresX = 111320 * Math.cos(meanLat * Math.PI / 180);
  const metresY = 110574;
  const [originX, originY] = ring[0];
  let twiceArea = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const a = [(ring[index][0] - originX) * metresX, (ring[index][1] - originY) * metresY];
    const b = [(ring[index + 1][0] - originX) * metresX, (ring[index + 1][1] - originY) * metresY];
    twiceArea += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(twiceArea) / 2;
}

function multiPolygonAreaSqm(polygons) {
  return polygons.reduce(
    (total, polygon) => total + polygon.reduce((area, ring, index) => area + (index === 0 ? 1 : -1) * ringAreaSqm(ring), 0),
    0,
  );
}

export function planRegime(type) {
  if (type === "qualified_bplan") return "section_30_1";
  if (type === "project_bplan") return "section_30_2";
  if (type === "simple_bplan") return "section_30_3";
  return "unresolved";
}

export function assignZoneToParcel(parcel, zone, planType) {
  const parcelGeometry = typeof parcel.geometryGeojson === "string" ? JSON.parse(parcel.geometryGeojson) : parcel.geometryGeojson;
  const parcelBbox = [parcel.bboxWest, parcel.bboxSouth, parcel.bboxEast, parcel.bboxNorth];
  if (!bboxOverlaps(parcelBbox, zone.bbox)) return null;
  const intersection = polygonClipping.intersection(multiPolygon(parcelGeometry), multiPolygon(zone.geometry));
  if (!intersection.length) return null;
  const intersectionAreaSqm = multiPolygonAreaSqm(intersection);
  if (intersectionAreaSqm < 0.01) return null;
  return {
    parcelId: parcel.id,
    planKey: zone.properties.planKey,
    zoneKey: zone.properties.zoneKey,
    legalRegime: planRegime(planType),
    coverageRatio: Math.min(1, intersectionAreaSqm / parcel.areaSqm),
    intersectionAreaSqm,
    intersectionGeojson: JSON.stringify({ type: "MultiPolygon", coordinates: intersection }),
    assignmentMethod: "georeferenced_zone_intersection",
    confidence: zone.properties.confidence ?? "medium",
  };
}

async function main() {
  const parcelsPath = option("parcels", "data/import/alkis-parcels.ndjson");
  const plansPath = option("plans", "data/import/bplans-fixed.ndjson");
  const zonesPath = resolve(option("zones", "data/georeferencing/bplans/output.geojson"));
  const output = resolve(option("output", "data/import/parcel-bplan-zone-segments.ndjson"));
  const artifact = JSON.parse(await readFile(zonesPath, "utf8"));
  if (artifact.schemaVersion !== "bplan-georeferenced-zones-v1" || !artifact.qa?.passed) throw new Error("Zones input must be a QA-passed bplan-georeferenced-zones-v1 artifact");
  const plans = [];
  for await (const plan of iterateNdjson(plansPath)) if (plan.planKey === artifact.planKey) plans.push(plan);
  const planTypes = new Set(plans.map((plan) => plan.planType));
  if (planTypes.size !== 1) throw new Error(`Expected exactly one plan type for ${artifact.planKey}; found ${[...planTypes].join(", ") || "none"}`);
  const planType = [...planTypes][0];
  const zones = artifact.features;
  await mkdir(dirname(output), { recursive: true });
  const writer = createWriteStream(output, { encoding: "utf8" });
  let processed = 0;
  let count = 0;
  for await (const parcel of iterateNdjson(parcelsPath)) {
    for (const zone of zones) {
      const segment = assignZoneToParcel(parcel, zone, planType);
      if (!segment) continue;
      writer.write(`${JSON.stringify(segment)}\n`);
      count += 1;
    }
    processed += 1;
    if (processed % 50_000 === 0) process.stderr.write(`Processed ${processed} parcels; found ${count} zone intersections\r`);
  }
  await new Promise((done, reject) => { writer.end(done); writer.on("error", reject); });
  process.stderr.write(`Wrote ${count} parcel/B-Plan zone intersections to ${output}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
