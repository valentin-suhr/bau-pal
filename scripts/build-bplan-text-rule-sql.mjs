#!/usr/bin/env node

import { createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
function option(name, fallback) { const p = `--${name}=`; return process.argv.find((v) => v.startsWith(p))?.slice(p.length) ?? fallback; }
function sql(v) { if (v == null) return "NULL"; if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL"; return `'${String(v).replaceAll("'", "''")}'`; }
const input = createInterface({ input: createReadStream(resolve(option("input", "data/import/bplan-text-rule-candidates.ndjson"))), crlfDelay: Infinity });
const output = createWriteStream(resolve(option("output", "data/import/bplan-text-rule-candidates.sql")), { encoding: "utf8" });
const mode = option("mode", "replace");
if (!["replace", "incremental"].includes(mode)) throw new Error("mode must be replace or incremental");
output.write("BEGIN TRANSACTION;\n");
if (mode === "replace") output.write("DELETE FROM planning_rules WHERE extraction_method IN ('embedded_text_mention','ocr');\n");
const clearedAssets = new Set();
let written = 0;
for await (const line of input) {
  if (!line.trim()) continue; const r = JSON.parse(line);
  if (mode === "incremental" && !clearedAssets.has(r.assetUrl)) {
    output.write(`DELETE FROM planning_rules WHERE extraction_method IN ('embedded_text_mention','ocr') AND substr(source_locator,1,${String(r.assetUrl).length})=${sql(r.assetUrl)};\n`);
    clearedAssets.add(r.assetUrl);
  }
  const locator = `${r.assetUrl}#page=${r.page}; ${r.extractionMethod === "ocr" ? "OCR" : "embedded text"} offset ${r.characterOffset}; sha256 ${r.contentHashSha256 ?? "unknown"}`;
  const interpretation = `${r.interpretation} Context: ${r.context}`;
  output.write(`INSERT INTO planning_rules (document_id,zone_id,applicability,rule_type,numeric_value,text_value,interpretation,extraction_method,confidence,review_status,source_id,source_locator) SELECT d.id,NULL,${sql(r.applicability)},${sql(r.ruleType)},${sql(r.numericValue)},${sql(r.textValue)},${sql(interpretation)},${sql(r.extractionMethod)},${sql(r.confidence)},${sql(r.reviewStatus)},d.source_id,${sql(locator)} FROM planning_documents d WHERE d.plan_key=${sql(r.planKey)};\n`);
  written += 1;
}
output.write("COMMIT;\n"); await new Promise((done, reject) => { output.end(done); output.on("error", reject); }); process.stderr.write(`Wrote ${written} B-Plan text mention inserts in ${mode} mode\n`);
