#!/usr/bin/env node

import { createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
function option(name, fallback) { const p = `--${name}=`; return process.argv.find((v) => v.startsWith(p))?.slice(p.length) ?? fallback; }
function sql(v) { if (v == null) return "NULL"; return `'${String(v).replaceAll("'", "''")}'`; }
const input = createInterface({ input: createReadStream(resolve(option("input", "data/import/parcel-fnp-context.ndjson"))), crlfDelay: Infinity });
const output = createWriteStream(resolve(option("output", "data/import/parcel-fnp-context.sql")), { encoding: "utf8" });
output.write("BEGIN TRANSACTION;\nDELETE FROM parcel_planning_observations WHERE observation_type='fnp_land_use_candidate' AND extraction_method='official_fnp_centroid_overlay_v1';\n");
let written = 0;
for await (const line of input) {
  if (!line.trim()) continue; const r = JSON.parse(line); if (!r.landUse) continue;
  const evidence = JSON.stringify({ purpose: r.purpose, officialId: r.officialId, objectCode: r.objectCode, objectNumber: r.objectNumber, matchCount: r.matchCount, sourceUpdatedAt: r.sourceUpdatedAt, warning: "The FNP is preparatory land-use evidence and does not determine whether BauGB section 34 or 35 applies." });
  output.write(`INSERT INTO parcel_planning_observations (parcel_id,observation_type,text_value,extraction_method,confidence,review_status,source_id,source_locator,evidence_json) SELECT ${sql(r.parcelId)},'fnp_land_use_candidate',${sql(r.landUse)},'official_fnp_centroid_overlay_v1',${sql(r.confidence)},'machine_checked',s.id,${sql(`FNP feature ${r.officialId}`)},${sql(evidence)} FROM sources s JOIN parcel_jurisdiction_contexts j ON j.parcel_id=${sql(r.parcelId)} AND j.workflow='section_34_35_unresolved' WHERE s.source_key='berlin-fnp-current-wfs';\n`);
  written += 1;
}
output.write("COMMIT;\n"); await new Promise((done, reject) => { output.end(done); output.on("error", reject); }); process.stderr.write(`Wrote ${written} conditional FNP observation inserts\n`);
