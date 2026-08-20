#!/usr/bin/env node
import { createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
const option = (name, fallback) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const sql = (value) => value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
const input = createInterface({ input: createReadStream(resolve(option("input", "data/import/parcel-development-capacity.ndjson"))), crlfDelay: Infinity });
const output = createWriteStream(resolve(option("output", "data/import/parcel-development-capacity.sql")), { encoding: "utf8" });
output.write("BEGIN TRANSACTION;\n"); let count = 0;
for await (const line of input) { if (!line.trim()) continue; const row = JSON.parse(line);
  output.write(`DELETE FROM parcel_planning_observations WHERE parcel_id=${sql(row.parcelId)} AND observation_type='development_capacity_screen';\n`);
  output.write(`INSERT INTO parcel_planning_observations (parcel_id,observation_type,text_value,extraction_method,confidence,review_status,source_id,source_locator,evidence_json) SELECT ${sql(row.parcelId)},${sql(row.observationType)},${sql(row.textValue)},${sql(row.extractionMethod)},${sql(row.confidence)},${sql(row.reviewStatus)},id,${sql(row.sourceLocator)},${sql(JSON.stringify(row.evidence))} FROM sources WHERE source_key=${sql(row.sourceKey)};\n`); count += 1;
}
output.write("COMMIT;\n"); await new Promise((done, reject) => { output.end(done); output.on("error", reject); });
process.stderr.write(`Wrote ${count} development-capacity upserts\n`);
