#!/usr/bin/env node

import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";

function option(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}
async function readRows(path) {
  const rows = [];
  const reader = createInterface({ input: createReadStream(resolve(path)), crlfDelay: Infinity });
  for await (const line of reader) if (line.trim()) rows.push(JSON.parse(line));
  return rows;
}
async function* iterateRows(path) {
  const reader = createInterface({ input: createReadStream(resolve(path)), crlfDelay: Infinity });
  for await (const line of reader) if (line.trim()) yield JSON.parse(line);
}
function gridCells(bbox, padding = 0, size = 0.005) {
  const result = [];
  const x0 = Math.floor((bbox[0] - padding) / size), x1 = Math.floor((bbox[2] + padding) / size);
  const y0 = Math.floor((bbox[1] - padding) / size), y1 = Math.floor((bbox[3] + padding) / size);
  for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) result.push(`${x}:${y}`);
  return result;
}
function buildIndex(lines) {
  const index = new Map();
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    for (const cell of gridCells(lines[lineIndex].bbox)) {
      const values = index.get(cell) ?? [];
      values.push(lineIndex);
      index.set(cell, values);
    }
  }
  return index;
}
function polygonRings(geometry) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.flat();
}
function lineStrings(geometry) {
  return geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
}
function project(point, origin, cosLat) {
  return [(point[0] - origin[0]) * 111320 * cosLat, (point[1] - origin[1]) * 110574];
}
function pointSegmentDistance(point, start, end) {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
}
function orientation(a, b, c) {
  const value = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return Math.abs(value) < 1e-8 ? 0 : Math.sign(value);
}
function segmentsIntersect(a, b, c, d) {
  return orientation(a, b, c) !== orientation(a, b, d) && orientation(c, d, a) !== orientation(c, d, b);
}
function segmentDistance(a, b, c, d) {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}
function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i], b = ring[j];
    if ((a[1] > point[1]) !== (b[1] > point[1])
      && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function proximity(parcelGeometry, lineGeometry, origin) {
  const cosLat = Math.cos(origin[1] * Math.PI / 180);
  const rings = polygonRings(parcelGeometry).map((ring) => ring.map((point) => project(point, origin, cosLat)));
  const lines = lineStrings(lineGeometry).map((line) => line.map((point) => project(point, origin, cosLat)));
  let minimum = Infinity;
  for (const line of lines) {
    if (line.some((point) => pointInRing(point, rings[0]))) return { distanceM: 0, relation: "intersects" };
    for (let li = 0; li < line.length - 1; li += 1) {
      for (const ring of rings) {
        for (let pi = 0; pi < ring.length - 1; pi += 1) {
          minimum = Math.min(minimum, segmentDistance(line[li], line[li + 1], ring[pi], ring[pi + 1]));
          if (minimum === 0) return { distanceM: 0, relation: "touches" };
        }
      }
    }
  }
  return { distanceM: minimum, relation: "within_tolerance" };
}

async function main() {
  const parcelsPath = option("parcels", "data/import/alkis-parcels.ndjson");
  const lines = await readRows(option("lines", "data/import/fluchtlinien.ndjson"));
  const output = resolve(option("output", "data/import/parcel-fluchtlinien.ndjson"));
  const toleranceM = Number(option("tolerance-m", "2"));
  if (!(toleranceM >= 0 && toleranceM <= 20)) throw new Error("tolerance-m must be between 0 and 20");
  const index = buildIndex(lines);
  await mkdir(dirname(output), { recursive: true });
  const writer = createWriteStream(output, { encoding: "utf8" });
  let processed = 0, matched = 0;
  for await (const parcel of iterateRows(parcelsPath)) {
    const bbox = [parcel.bboxWest, parcel.bboxSouth, parcel.bboxEast, parcel.bboxNorth];
    const padding = toleranceM / 100_000;
    const candidates = new Set(gridCells(bbox, padding).flatMap((cell) => index.get(cell) ?? []));
    const parcelGeometry = JSON.parse(parcel.geometryGeojson);
    for (const lineIndex of candidates) {
      const line = lines[lineIndex];
      if (line.borough !== parcel.borough) continue;
      if (line.bbox[0] - padding > bbox[2] || line.bbox[2] + padding < bbox[0]
        || line.bbox[1] - padding > bbox[3] || line.bbox[3] + padding < bbox[1]) continue;
      const result = proximity(parcelGeometry, JSON.parse(line.geometryGeojson), [parcel.centroidLng, parcel.centroidLat]);
      if (result.distanceM > toleranceM) continue;
      writer.write(`${JSON.stringify({ parcelId: parcel.id, officialLineId: line.officialId,
        lineType: line.lineType, relation: result.relation, distanceM: result.distanceM,
        assignmentMethod: "official_vector_proximity", confidence: result.distanceM === 0 ? "high" : "medium" })}\n`);
      matched += 1;
    }
    processed += 1;
    if (processed % 25_000 === 0) process.stderr.write(`Processed ${processed}; matched ${matched} parcel/line pairs\r`);
  }
  await new Promise((done, reject) => { writer.end(done); writer.on("error", reject); });
  process.stderr.write(`\nWrote ${matched} parcel/Fluchtlinie relations to ${output}\n`);
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
