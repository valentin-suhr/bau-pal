#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { localD1Path } from "./local-d1-path.mjs";

const option = (name, fallback) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const input = path.resolve(option("input", "data/import/bplan-assets.ndjson"));
const output = path.resolve(option("output", "data/import/bplan-assets-single-parcel.ndjson"));
const minimumCoverage = Number(option("minimum-coverage", "0.98"));
if (!Number.isFinite(minimumCoverage) || minimumCoverage <= 0 || minimumCoverage > 1) throw new Error("minimum-coverage must be in (0,1]");

const database = await localD1Path();
const query = `
  SELECT d.plan_key
  FROM planning_documents d
  JOIN parcel_planning_segments s ON s.document_id=d.id
  GROUP BY d.id
  HAVING count(DISTINCT s.parcel_id)=1 AND min(s.coverage_ratio)>=${minimumCoverage}
  ORDER BY d.plan_key`;
const planKeys = new Set(execFileSync("sqlite3", [database, query], { encoding: "utf8" }).trim().split("\n").filter(Boolean));
const rows = fs.readFileSync(input, "utf8").split("\n").filter(Boolean).map(JSON.parse)
  .filter((row) => planKeys.has(row.planKey) && ["plan_sheet", "text_stipulations", "rationale"].includes(row.assetType));
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
console.log(JSON.stringify({ plans: planKeys.size, assets: rows.length, minimumCoverage, output }));
