#!/usr/bin/env node

import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";

function option(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}
function cleanUrl(value) {
  const url = String(value ?? "").trim();
  if (!url) return null;
  try { return new URL(url).toString(); } catch { return null; }
}
function asset(planKey, assetType, url) {
  const clean = cleanUrl(url);
  return clean ? {
    planKey, assetType, url: clean, retrievalStatus: "pending",
    ocrStatus: assetType === "detail_page" ? "not_needed" : "pending",
    extractionStatus: assetType === "detail_page" ? "needs_review" : "pending",
  } : null;
}

async function main() {
  const input = resolve(option("input", "data/import/bplans-fixed.ndjson"));
  const output = resolve(option("output", "data/import/bplan-assets.ndjson"));
  await mkdir(dirname(output), { recursive: true });
  const reader = createInterface({ input: createReadStream(input), crlfDelay: Infinity });
  const writer = createWriteStream(output, { encoding: "utf8" });
  const seen = new Set();
  const counts = { plans: 0, assets: 0, plan_sheet: 0, rationale: 0, detail_page: 0 };
  for await (const line of reader) {
    if (!line.trim()) continue;
    const plan = JSON.parse(line);
    counts.plans += 1;
    const assets = [
      asset(plan.planKey, "plan_sheet", plan.scanUrl),
      asset(plan.planKey, "rationale", plan.rationaleUrl),
      asset(plan.planKey, "detail_page", plan.detailUrl),
    ].filter(Boolean);
    for (const row of assets) {
      if (seen.has(row.url)) continue;
      seen.add(row.url);
      writer.write(`${JSON.stringify(row)}\n`);
      counts.assets += 1;
      counts[row.assetType] += 1;
    }
  }
  await new Promise((done, reject) => { writer.end(done); writer.on("error", reject); });
  process.stderr.write(`${JSON.stringify(counts)}\nWrote asset queue to ${output}\n`);
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
