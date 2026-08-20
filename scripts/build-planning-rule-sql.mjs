#!/usr/bin/env node
import { createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
function option(name,fallback){const p=`--${name}=`;return process.argv.find((v)=>v.startsWith(p))?.slice(p.length)??fallback}
function sql(v){if(v==null)return"NULL";if(typeof v==="number")return Number.isFinite(v)?String(v):"NULL";return `'${String(v).replaceAll("'","''")}'`}
const input=createInterface({input:createReadStream(resolve(option("input","data/import/bplan-wfs-rules.ndjson"))),crlfDelay:Infinity});
const outputPath=resolve(option("output","data/import/bplan-wfs-rules.sql"));await mkdir(dirname(outputPath),{recursive:true});const output=createWriteStream(outputPath,{encoding:"utf8"});
output.write("BEGIN TRANSACTION;\nDELETE FROM planning_rules WHERE applicability='document_summary' AND source_id=(SELECT id FROM sources WHERE source_key='berlin-bplan-wfs');\n");let count=0;
for await(const line of input){if(!line.trim())continue;const r=JSON.parse(line);output.write(`INSERT INTO planning_rules (document_id,zone_id,applicability,rule_type,numeric_value,text_value,unit,legal_citation,interpretation,extraction_method,confidence,review_status,source_id,source_locator) SELECT d.id,${r.zoneKey?`(SELECT id FROM planning_zones WHERE document_id=d.id AND zone_key=${sql(r.zoneKey)})`:"NULL"},${sql(r.applicability)},${sql(r.ruleType)},${sql(r.numericValue)},${sql(r.textValue)},${sql(r.unit)},${sql(r.legalCitation)},${sql(r.interpretation)},${sql(r.extractionMethod)},${sql(r.confidence)},${sql(r.reviewStatus)},s.id,${sql(r.sourceLocator)} FROM planning_documents d JOIN sources s ON s.source_key=${sql(r.sourceKey)} WHERE d.plan_key=${sql(r.planKey)};\n`);count+=1}
output.write("COMMIT;\n");await new Promise((done,reject)=>{output.end(done);output.on("error",reject)});process.stderr.write(`Wrote ${count} planning-rule inserts\n`);
