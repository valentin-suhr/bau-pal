#!/usr/bin/env node

import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";

function option(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}
function sql(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function main() {
  const input = resolve(option("input", "data/import/parcel-planning-segments.ndjson"));
  const output = resolve(option("output", "data/import/parcel-planning-segments.sql"));
  await mkdir(dirname(output), { recursive: true });
  const reader = createInterface({ input: createReadStream(input), crlfDelay: Infinity });
  const writer = createWriteStream(output, { encoding: "utf8" });
  writer.write("BEGIN TRANSACTION;\n");
  let count = 0;
  for await (const line of reader) {
    if (!line.trim()) continue;
    const segment = JSON.parse(line);
    writer.write(`INSERT INTO parcel_planning_segments (parcel_id,zone_id,document_id,legal_regime,coverage_ratio,intersection_area_sqm,intersection_geojson,precedence_rank,is_controlling,assignment_method,confidence) SELECT ${sql(segment.parcelId)},z.id,d.id,${sql(segment.legalRegime)},${sql(segment.coverageRatio)},${sql(segment.intersectionAreaSqm)},${sql(segment.intersectionGeojson)},0,0,${sql(segment.assignmentMethod)},${sql(segment.confidence)} FROM planning_documents d JOIN planning_zones z ON z.document_id=d.id AND z.zone_key=${sql(segment.zoneKey)} WHERE d.plan_key=${sql(segment.planKey)} ON CONFLICT(parcel_id,document_id,zone_id) DO UPDATE SET legal_regime=excluded.legal_regime,coverage_ratio=excluded.coverage_ratio,intersection_area_sqm=excluded.intersection_area_sqm,intersection_geojson=excluded.intersection_geojson,assignment_method=excluded.assignment_method,confidence=excluded.confidence;\n`);
    count += 1;
  }
  writer.write("COMMIT;\n");
  await new Promise((done, reject) => { writer.end(done); writer.on("error", reject); });
  process.stderr.write(`Wrote ${count} planning-segment upserts to ${output}\n`);
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
