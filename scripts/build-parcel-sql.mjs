#!/usr/bin/env node

import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";

function option(name, fallback) {
  const prefix = `--${name}=`;
  const match = process.argv.find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Cannot serialise a non-finite number");
    return String(value);
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

const columns = [
  "id", "alkis_uuid", "numerator", "denominator", "cadastral_district_code",
  "cadastral_district", "flur", "borough", "locality", "area_sqm",
  "centroid_lng", "centroid_lat", "bbox_west", "bbox_south", "bbox_east",
  "bbox_north", "geometry_geojson", "source_feature_timestamp",
];

const fields = [
  "id", "alkisUuid", "numerator", "denominator", "cadastralDistrictCode",
  "cadastralDistrict", "flur", "borough", "locality", "areaSqm",
  "centroidLng", "centroidLat", "bboxWest", "bboxSouth", "bboxEast",
  "bboxNorth", "geometryGeojson", "sourceFeatureTimestamp",
];

async function main() {
  const input = resolve(option("input", "data/import/alkis-parcels-locality.ndjson"));
  const output = resolve(option("output", "data/import/alkis-parcels.sql"));
  await mkdir(dirname(output), { recursive: true });
  const writer = createWriteStream(output, { encoding: "utf8" });
  const reader = createInterface({ input: createReadStream(input), crlfDelay: Infinity });

  writer.write("BEGIN TRANSACTION;\n");
  let count = 0;
  for await (const line of reader) {
    if (!line.trim()) continue;
    const parcel = JSON.parse(line);
    const values = fields.map((field) => sqlValue(parcel[field])).join(",");
    writer.write(
      `INSERT INTO parcels (${columns.join(",")}) VALUES (${values}) ` +
      "ON CONFLICT(id) DO UPDATE SET " +
      columns.slice(1).map((column) => `${column}=excluded.${column}`).join(",") +
      ",updated_at=CURRENT_TIMESTAMP;\n",
    );
    count += 1;
  }
  writer.write("COMMIT;\n");
  await new Promise((resolveDone, reject) => {
    writer.end(resolveDone);
    writer.on("error", reject);
  });
  process.stderr.write(`Wrote ${count} parcel upserts to ${output}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
