#!/usr/bin/env node

import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";

const WFS = "https://gdi.berlin.de/services/wfs/berlinermauer";
const LAYERS = ["a_grenzmauer", "c_politischegrenze"];
const CELL = 0.002;
const REVIEW_DISTANCE_M = 150;
function option(name, fallback) { const p = `--${name}=`; return process.argv.find((v) => v.startsWith(p))?.slice(p.length) ?? fallback; }
async function exists(path) { try { await access(path); return true; } catch { return false; } }
function bucket(value) { return Math.floor(value / CELL); }
function metres(point, a, b) {
  const latitude = point[1] * Math.PI / 180;
  const scaleX = 111_320 * Math.cos(latitude), scaleY = 110_540;
  const px = point[0] * scaleX, py = point[1] * scaleY;
  const ax = a[0] * scaleX, ay = a[1] * scaleY, bx = b[0] * scaleX, by = b[1] * scaleY;
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
async function fetchLayer(layer) {
  const url = new URL(WFS);
  url.search = new URLSearchParams({ service: "WFS", version: "2.0.0", request: "GetFeature", typeNames: `berlinermauer:${layer}`, outputFormat: "application/json", srsName: "EPSG:4326" });
  const response = await fetch(url, { headers: { "user-agent": "Grounded-Berlin-historical-sector/1.0" } });
  if (!response.ok) throw new Error(`Berlin wall WFS ${layer} returned ${response.status}`);
  return response.json();
}
function segments(features) {
  const output = [];
  for (const feature of features) {
    const lines = feature.geometry.type === "LineString" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const line of lines) for (let index = 1; index < line.length; index += 1) output.push({ a: line[index - 1], b: line[index], layer: feature.__layer, id: feature.id });
  }
  return output;
}
function buildIndex(items) {
  const byLatitude = new Map(), nearby = new Map();
  for (const segment of items) {
    const minY = Math.min(segment.a[1], segment.b[1]), maxY = Math.max(segment.a[1], segment.b[1]);
    for (let y = bucket(minY); y <= bucket(maxY); y += 1) {
      if (!byLatitude.has(y)) byLatitude.set(y, []);
      byLatitude.get(y).push(segment);
    }
    const minX = Math.min(segment.a[0], segment.b[0]), maxX = Math.max(segment.a[0], segment.b[0]);
    for (let x = bucket(minX) - 2; x <= bucket(maxX) + 2; x += 1) for (let y = bucket(minY) - 2; y <= bucket(maxY) + 2; y += 1) {
      const key = `${x}:${y}`; if (!nearby.has(key)) nearby.set(key, []); nearby.get(key).push(segment);
    }
  }
  return { byLatitude, nearby };
}
function classify(point, index) {
  const crossings = [];
  for (const segment of index.byLatitude.get(bucket(point[1])) ?? []) {
    const [a, b] = [segment.a, segment.b];
    if ((a[1] > point[1]) === (b[1] > point[1])) continue;
    const x = a[0] + (point[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1]);
    if (x > point[0]) crossings.push(x);
  }
  crossings.sort((a, b) => a - b);
  const unique = crossings.filter((value, position) => position === 0 || Math.abs(value - crossings[position - 1]) > 0.00001);
  let nearest = Infinity;
  for (const segment of index.nearby.get(`${bucket(point[0])}:${bucket(point[1])}`) ?? []) nearest = Math.min(nearest, metres(point, segment.a, segment.b));
  return { west: unique.length % 2 === 1, crossings: unique.length, nearestBoundaryM: Number.isFinite(nearest) ? nearest : null };
}

export { classify, buildIndex, segments };
async function main() {
  const parcelPath = resolve(option("parcels", "data/import/alkis-parcels-locality.ndjson"));
  const outputPath = resolve(option("output", "data/import/alkis-parcels-sector.ndjson"));
  const evidencePath = resolve(option("evidence", "data/import/berlin-wall-boundary.geojson"));
  let evidence;
  if (await exists(evidencePath) && option("refresh", "false") !== "true") evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  else {
    const collections = await Promise.all(LAYERS.map(fetchLayer));
    const features = collections.flatMap((collection, index) => collection.features.map((feature) => ({ ...feature, __layer: LAYERS[index] })));
    evidence = { type: "FeatureCollection", features, retrievedAt: new Date().toISOString(), sourceUrl: WFS };
    await mkdir(dirname(evidencePath), { recursive: true }); await writeFile(evidencePath, JSON.stringify(evidence));
  }
  // The political-deviation layer is retained as evidence but cannot simply be
  // unioned with the physical wall: overlapping alternatives would invert the
  // ray parity. The wall alone is therefore an independent corroboration layer,
  // never a replacement legal boundary.
  const index = buildIndex(segments(evidence.features.filter((feature) => feature.__layer === "a_grenzmauer")));
  const input = createInterface({ input: createReadStream(parcelPath), crlfDelay: Infinity });
  await mkdir(dirname(outputPath), { recursive: true }); const output = createWriteStream(outputPath, { encoding: "utf8" });
  const counts = { processed: 0, corroborated: 0, disagreed: 0, nearBoundary: 0, noCrossing: 0 };
  for await (const line of input) {
    if (!line.trim()) continue;
    const row = JSON.parse(line), point = [row.centroidLng, row.centroidLat];
    const result = classify(point, index), proxyWest = row.jurisdictionContext?.historicalSector === "former_west_proxy";
    const nearBoundary = result.nearestBoundaryM != null && result.nearestBoundaryM <= REVIEW_DISTANCE_M;
    const agrees = result.west === proxyWest;
    counts.processed += 1; if (!result.crossings) counts.noCrossing += 1; if (agrees) counts.corroborated += 1; else counts.disagreed += 1; if (nearBoundary) counts.nearBoundary += 1;
    const context = {
      ...row.jurisdictionContext,
      historicalBoundaryCheck: agrees ? "corroborated" : "disagrees",
      historicalBoundaryCandidate: result.west ? "former_west" : "former_east",
      historicalBoundaryDistanceM: result.nearestBoundaryM,
      historicalBoundaryReview: nearBoundary || !agrees,
      historicalBoundarySourceKey: "berlin-wall-1989-wfs",
      historicalBoundarySourceLocator: `official 1989 wall line ray-crossing; ${result.crossings} unique crossings eastward; nearest line ${result.nearestBoundaryM == null ? `more than ${REVIEW_DISTANCE_M} m` : `${result.nearestBoundaryM.toFixed(1)} m`}`,
    };
    output.write(`${JSON.stringify({ ...row, jurisdictionContext: context })}\n`);
    if (counts.processed % 50000 === 0) process.stderr.write(`Checked ${counts.processed} parcels\r`);
  }
  await new Promise((done, reject) => { output.end(done); output.on("error", reject); });
  process.stderr.write(`\n${JSON.stringify(counts)}\n`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
