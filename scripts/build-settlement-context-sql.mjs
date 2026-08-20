#!/usr/bin/env node
import { createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
function option(name, fallback) { const p = `--${name}=`; return process.argv.find((v) => v.startsWith(p))?.slice(p.length) ?? fallback; }
function sql(v) { return v == null ? "NULL" : `'${String(v).replaceAll("'", "''")}'`; }
const input = createInterface({ input: createReadStream(resolve(option("input", "data/import/parcel-building-context.ndjson"))), crlfDelay: Infinity });
const output = createWriteStream(resolve(option("output", "data/import/parcel-building-context.sql")), { encoding: "utf8" }); output.write("BEGIN TRANSACTION;\nDELETE FROM parcel_planning_observations WHERE observation_type='settlement_context' AND extraction_method='official_building_centroid_metrics';\n"); let count = 0;
for await (const line of input) { if (!line.trim()) continue; const r = JSON.parse(line); output.write(`INSERT INTO parcel_planning_observations (parcel_id,observation_type,text_value,extraction_method,confidence,review_status,source_id,source_locator,evidence_json) SELECT ${sql(r.parcelId)},${sql(r.observationType)},${sql(r.textValue)},${sql(r.extractionMethod)},${sql(r.confidence)},${sql(r.reviewStatus)},id,${sql(r.sourceLocator)},${sql(JSON.stringify(r.evidence))} FROM sources WHERE source_key=${sql(r.sourceKey)};\n`); count += 1; }
output.write("COMMIT;\n"); await new Promise((done, reject) => { output.end(done); output.on("error", reject); }); process.stderr.write(`Wrote ${count} settlement-context inserts\n`);
