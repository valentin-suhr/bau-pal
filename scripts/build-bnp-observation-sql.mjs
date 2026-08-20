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
  const input = resolve(option("input", "data/import/parcel-bnp-candidates.ndjson"));
  const output = resolve(option("output", "data/import/parcel-bnp-observations.sql"));
  await mkdir(dirname(output), { recursive: true });
  const reader = createInterface({ input: createReadStream(input), crlfDelay: Infinity });
  const writer = createWriteStream(output, { encoding: "utf8" });
  writer.write("BEGIN TRANSACTION;\nDELETE FROM parcel_planning_observations WHERE observation_type='land_use_candidate' AND extraction_method='raster_colour_candidate_v1';\n");
  let written = 0;
  for await (const line of reader) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (!row.candidateLandUseCode) continue;
    const evidence = JSON.stringify({
      candidateLandUse: row.candidateLandUse, sampleAgreement: row.sampleAgreement,
      classifiedPixelShare: row.classifiedPixelShare, colourDistance: row.colourDistance,
      pixelX: row.pixelX, pixelY: row.pixelY, easting: row.easting, northing: row.northing,
      warning: "Raster colour candidate; not a verified parcel rule. Baustufe and building-line stack unresolved.",
    });
    writer.write(`INSERT INTO parcel_planning_observations (parcel_id,document_id,observation_type,text_value,extraction_method,confidence,review_status,source_id,source_locator,evidence_json) SELECT ${sql(row.parcelId)},id,'land_use_candidate',${sql(row.candidateLandUseCode)},${sql(row.extractionMethod)},${sql(row.confidence)},'machine_checked',source_id,${sql(row.sourceLocator)},${sql(evidence)} FROM planning_documents WHERE plan_key='BNP-1958-60';\n`);
    written += 1;
  }
  writer.write("COMMIT;\n");
  await new Promise((done, reject) => { writer.end(done); writer.on("error", reject); });
  process.stderr.write(`Wrote ${written} BNP observation inserts to ${output}\n`);
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
