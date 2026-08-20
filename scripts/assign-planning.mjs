#!/usr/bin/env node

import { createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import polygonClipping from "polygon-clipping";

function option(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}
async function readNdjson(path) {
  const rows = [];
  const input = createInterface({ input: createReadStream(resolve(path)), crlfDelay: Infinity });
  for await (const line of input) if (line.trim()) rows.push(JSON.parse(line));
  return rows;
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
  const mx = 111320 * Math.cos(meanLat * Math.PI / 180);
  const my = 110574;
  const [originX, originY] = ring[0];
  let twiceArea = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const a = [(ring[index][0] - originX) * mx, (ring[index][1] - originY) * my];
    const b = [(ring[index + 1][0] - originX) * mx, (ring[index + 1][1] - originY) * my];
    twiceArea += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(twiceArea) / 2;
}
function multiPolygonAreaSqm(polygons) {
  return polygons.reduce((total, polygon) => total + polygon.reduce((area, ring, index) => area + (index === 0 ? 1 : -1) * ringAreaSqm(ring), 0), 0);
}
function planRegime(type) {
  if (type === "qualified_bplan") return "section_30_1";
  if (type === "project_bplan") return "section_30_2";
  if (type === "simple_bplan") return "section_30_3";
  return "unresolved";
}

function gridCells(bbox, cellSize = 0.02) {
  const cells = [];
  const x0 = Math.floor(bbox[0] / cellSize);
  const x1 = Math.floor(bbox[2] / cellSize);
  const y0 = Math.floor(bbox[1] / cellSize);
  const y1 = Math.floor(bbox[3] / cellSize);
  for (let x = x0; x <= x1; x += 1) {
    for (let y = y0; y <= y1; y += 1) cells.push(`${x}:${y}`);
  }
  return cells;
}

function buildPlanIndex(plans) {
  const index = new Map();
  for (let planIndex = 0; planIndex < plans.length; planIndex += 1) {
    for (const cell of gridCells(plans[planIndex].bbox)) {
      const entries = index.get(cell) ?? [];
      entries.push(planIndex);
      index.set(cell, entries);
    }
  }
  return index;
}

async function main() {
  const parcelsPath = option("parcels", "data/import/alkis-parcels.ndjson");
  const plans = await readNdjson(option("plans", "data/import/bplans-fixed.ndjson"));
  const planIndex = buildPlanIndex(plans);
  const output = resolve(option("output", "data/import/parcel-planning-segments.ndjson"));
  await mkdir(dirname(output), { recursive: true });
  const writer = createWriteStream(output, { encoding: "utf8" });
  let count = 0;
  let processed = 0;
  for await (const parcel of iterateNdjson(parcelsPath)) {
    const parcelGeometry = JSON.parse(parcel.geometryGeojson);
    const parcelBbox = [parcel.bboxWest, parcel.bboxSouth, parcel.bboxEast, parcel.bboxNorth];
    const candidateIndexes = new Set(gridCells(parcelBbox).flatMap((cell) => planIndex.get(cell) ?? []));
    for (const candidateIndex of candidateIndexes) {
      const plan = plans[candidateIndex];
      if (!bboxOverlaps(parcelBbox, plan.bbox)) continue;
      const intersection = polygonClipping.intersection(multiPolygon(parcelGeometry), multiPolygon(JSON.parse(plan.geometryGeojson)));
      if (!intersection.length) continue;
      const intersectionAreaSqm = multiPolygonAreaSqm(intersection);
      if (intersectionAreaSqm < 0.01) continue;
      const coverageRatio = Math.min(1, intersectionAreaSqm / parcel.areaSqm);
      writer.write(`${JSON.stringify({
        parcelId: parcel.id, planKey: plan.planKey, zoneKey: plan.zoneKey,
        legalRegime: planRegime(plan.planType), coverageRatio, intersectionAreaSqm,
        intersectionGeojson: JSON.stringify({ type: "MultiPolygon", coordinates: intersection }),
        assignmentMethod: "spatial_intersection", confidence: "official",
      })}\n`);
      count += 1;
    }
    processed += 1;
    if (processed % 10_000 === 0) process.stderr.write(`Processed ${processed} parcels; found ${count} intersections\r`);
  }
  await new Promise((done, reject) => { writer.end(done); writer.on("error", reject); });
  process.stderr.write(`Wrote ${count} parcel/B-Plan intersections to ${output}\n`);
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
