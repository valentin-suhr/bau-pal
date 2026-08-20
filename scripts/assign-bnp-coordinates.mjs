#!/usr/bin/env node

import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import proj4 from "proj4";

proj4.defs("EPSG:25833", "+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs +type=crs");

const BNP = {
  minX: 369641.49802,
  maxY: 5836324.99825,
  pixelSize: 1.5875,
  width: 19526,
  height: 20576,
};

function option(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}
async function coveredParcels(path) {
  const covered = new Set();
  const reader = createInterface({ input: createReadStream(resolve(path)), crlfDelay: Infinity });
  for await (const line of reader) if (line.trim()) covered.add(JSON.parse(line).parcelId);
  return covered;
}

async function main() {
  const parcelsPath = resolve(option("parcels", "data/import/alkis-parcels.ndjson"));
  const segmentsPath = option("segments", "data/import/parcel-planning-segments.ndjson");
  const output = resolve(option("output", "data/import/parcel-bnp-coordinates.ndjson"));
  const covered = await coveredParcels(segmentsPath);
  await mkdir(dirname(output), { recursive: true });
  const writer = createWriteStream(output, { encoding: "utf8" });
  const reader = createInterface({ input: createReadStream(parcelsPath), crlfDelay: Infinity });
  let read = 0;
  let written = 0;
  for await (const line of reader) {
    if (!line.trim()) continue;
    const parcel = JSON.parse(line);
    read += 1;
    if (covered.has(parcel.id)) continue;
    const [easting, northing] = proj4("EPSG:4326", "EPSG:25833", [parcel.centroidLng, parcel.centroidLat]);
    const pixelX = Math.floor((easting - BNP.minX) / BNP.pixelSize);
    const pixelY = Math.floor((BNP.maxY - northing) / BNP.pixelSize);
    if (pixelX < 0 || pixelY < 0 || pixelX >= BNP.width || pixelY >= BNP.height) continue;
    writer.write(`${JSON.stringify({ parcelId: parcel.id, easting, northing, pixelX, pixelY })}\n`);
    written += 1;
    if (read % 50_000 === 0) process.stderr.write(`Read ${read}; queued ${written} BNP samples\r`);
  }
  await new Promise((done, reject) => { writer.end(done); writer.on("error", reject); });
  process.stderr.write(`\nWrote ${written} uncovered-parcel coordinates to ${output}\n`);
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
