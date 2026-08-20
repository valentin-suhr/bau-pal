#!/usr/bin/env node

import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const WFS_URL = "https://gdi.berlin.de/services/wfs/alkis_ortsteile";
const TYPE_NAME = "alkis_ortsteile:ortsteile";

function option(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}
function visitCoordinates(coordinates, visit) {
  if (typeof coordinates?.[0] === "number") return visit(coordinates[0], coordinates[1]);
  for (const child of coordinates ?? []) visitCoordinates(child, visit);
}
function geometryBbox(geometry) {
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  visitCoordinates(geometry.coordinates, (x, y) => {
    bbox[0] = Math.min(bbox[0], x); bbox[1] = Math.min(bbox[1], y);
    bbox[2] = Math.max(bbox[2], x); bbox[3] = Math.max(bbox[3], y);
  });
  return bbox;
}
export function normalizeOrtsteil(feature, collectionTimestamp) {
  const properties = feature.properties ?? {};
  if (!feature.geometry || !["Polygon", "MultiPolygon"].includes(feature.geometry.type)) throw new Error("Unsupported Ortsteil geometry");
  if (!properties.uuid || !properties.nam) throw new Error("Ortsteil misses uuid or name");
  return {
    officialId: String(properties.uuid), localityCode: String(properties.sch ?? ""),
    name: String(properties.nam), areaSqm: Number(properties.gdf) || null,
    geometryGeojson: JSON.stringify(feature.geometry), bbox: feature.bbox ?? geometryBbox(feature.geometry),
    sourceUpdatedAt: collectionTimestamp ?? null,
  };
}
async function main() {
  const output = resolve(option("output", "data/import/ortsteile.ndjson"));
  const url = new URL(WFS_URL);
  url.search = new URLSearchParams({ service: "WFS", version: "2.0.0", request: "GetFeature",
    typeNames: TYPE_NAME, outputFormat: "application/json", srsName: "EPSG:4326", count: "200" }).toString();
  const response = await fetch(url, { headers: { "user-agent": "Grounded-Berlin-ortsteile-import/1.0" } });
  if (!response.ok) throw new Error(`Ortsteile WFS returned ${response.status}`);
  const collection = await response.json();
  await mkdir(dirname(output), { recursive: true });
  const writer = createWriteStream(output, { encoding: "utf8" });
  for (const feature of collection.features ?? []) writer.write(`${JSON.stringify(normalizeOrtsteil(feature, collection.timeStamp))}\n`);
  await new Promise((done, reject) => { writer.end(done); writer.on("error", reject); });
  process.stderr.write(`Wrote ${collection.features?.length ?? 0} Ortsteile to ${output}\n`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
