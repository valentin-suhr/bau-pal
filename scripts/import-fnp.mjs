#!/usr/bin/env node

import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const ENDPOINT = "https://gdi.berlin.de/services/wfs/fnp_ak";
const TYPE_NAME = "fnp_ak:fnp_ak_vektor";
function option(name, fallback) { const p = `--${name}=`; return process.argv.find((v) => v.startsWith(p))?.slice(p.length) ?? fallback; }
function visit(coordinates, callback) { if (typeof coordinates?.[0] === "number") return callback(coordinates[0], coordinates[1]); for (const child of coordinates ?? []) visit(child, callback); }
function bbox(geometry) { const b = [Infinity, Infinity, -Infinity, -Infinity]; visit(geometry.coordinates, (x, y) => { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); }); return b; }

async function main() {
  const output = resolve(option("output", "data/import/fnp-land-use.ndjson"));
  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({ service: "WFS", version: "2.0.0", request: "GetFeature", typeNames: TYPE_NAME, outputFormat: "application/json", srsName: "EPSG:4326", count: "10000" }).toString();
  const response = await fetch(url, { headers: { "user-agent": "Grounded-Berlin-FNP-import/1.0" } });
  if (!response.ok) throw new Error(`FNP WFS returned ${response.status}`);
  const collection = await response.json();
  await mkdir(dirname(output), { recursive: true });
  const writer = createWriteStream(output, { encoding: "utf8" });
  let written = 0;
  for (const feature of collection.features ?? []) {
    if (!feature.geometry || !["Polygon", "MultiPolygon"].includes(feature.geometry.type)) continue;
    const p = feature.properties ?? {};
    writer.write(`${JSON.stringify({ officialId: String(p.gisid ?? feature.id), landUse: p.nutzungsart ?? null, purpose: p.zweckbestimmung ?? null, objectCode: p.os ?? null, objectNumber: p.os_nr ?? null, geometryGeojson: JSON.stringify(feature.geometry), bbox: feature.bbox ?? bbox(feature.geometry), sourceUpdatedAt: collection.timeStamp ?? null })}\n`);
    written += 1;
  }
  await new Promise((done, reject) => { writer.end(done); writer.on("error", reject); });
  process.stderr.write(`Wrote ${written} official FNP polygons to ${output}\n`);
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
