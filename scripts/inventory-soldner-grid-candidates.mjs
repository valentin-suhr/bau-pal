#!/usr/bin/env node

import { readFile, writeFile, access, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";

const queuePath = resolve(process.argv[2] ?? "data/qa/bplan-zone-review-queue.json");
const outputPath = resolve(process.argv[3] ?? "data/qa/bplan-soldner-grid-candidates.json");
const queue = JSON.parse(await readFile(queuePath, "utf8"));

async function existing(paths) {
  for (const path of paths) try { await access(path); return path; } catch {}
  return null;
}

function sequences(values) {
  const unique = [...new Set(values)].sort((a, b) => a - b);
  const output = [];
  let current = [];
  for (const value of unique) {
    if (!current.length || value - current.at(-1) === 100) current.push(value);
    else { if (current.length >= 3) output.push(current); current = [value]; }
  }
  if (current.length >= 3) output.push(current);
  return output;
}

const rows = [];
for (const row of queue.rows.filter((item) => item.review_route === "requires_internal_zone_georeferencing")) {
  if (row.manual_review) {
    rows.push({
      plan_key: row.plan_key,
      status: "manual_reviewed_requires_internal_zone_trace",
      source_pdf: row.manual_review.source_pdf,
      reason: row.manual_review.reason,
    });
    continue;
  }
  const textPath = await existing([
    `data/documents/bplan-text/${row.plan_key}--plan_sheet.txt`,
    `data/documents/bplan-text-priority-ocr/${row.plan_key}--plan_sheet.txt`,
    `data/documents/bplan-text-single-parcel-ocr/${row.plan_key}--plan_sheet.txt`,
  ]);
  if (!textPath) { rows.push({ plan_key: row.plan_key, status: "no_extracted_sheet_text" }); continue; }
  const text = await readFile(textPath, "utf8");
  const values = [...text.matchAll(/\b([1-3]\d)[ .]?(\d{3})\b/g)]
    .map((match) => Number(`${match[1]}${match[2]}`))
    .filter((value) => value >= 15_000 && value <= 35_000);
  const runs = sequences(values).sort((a, b) => b.length - a.length || a[0] - b[0]);
  rows.push({
    plan_key: row.plan_key,
    status: runs.length >= 2 ? "two_axis_coordinate_sequence_unreviewed" : runs.length === 1 ? "possible_single_axis_ocr" : "no_regular_grid_sequence",
    text_path: textPath,
    coordinate_runs: runs,
  });
}

const summary = Object.fromEntries([...new Set(rows.map((row) => row.status))].sort().map((status) => [status, rows.filter((row) => row.status === status).length]));
const output = {
  generatedAt: new Date().toISOString(),
  sourceQueue: queuePath,
  methodology: "OCR triage only: values from 15000 through 35000 are grouped into runs spaced exactly 100 units. Two runs of at least three labels indicate an unreviewed two-axis coordinate sequence, not proof of a machine-detectable grid: axis identity, line geometry, rotation, crop, labels and the legal sheet all require visual validation.",
  summary,
  rows,
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ output: outputPath, summary }, null, 2));
