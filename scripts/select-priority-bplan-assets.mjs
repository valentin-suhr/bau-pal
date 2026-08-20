#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { localD1Path } from "./local-d1-path.mjs";

const option = (name, fallback) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const limit = Number(option("limit", "100"));
if (!Number.isInteger(limit) || limit <= 0) throw new Error("limit must be a positive integer");
const types = option("types", "plan_sheet").split(",").filter(Boolean);
const statuses = option("statuses", "pending,failed").split(",").filter(Boolean);
const borough = option("borough", "").trim();
const locality = option("locality", "").trim();
if (!statuses.length) throw new Error("statuses must contain at least one retrieval status");
const input = path.resolve(option("input", "data/import/bplan-assets.ndjson"));
const output = path.resolve(option("output", "data/import/bplan-assets-priority.ndjson"));
const database = await localD1Path();
const quotedTypes = types.map((value) => `'${value.replaceAll("'", "''")}'`).join(",");
const quotedStatuses = statuses.map((value) => `'${value.replaceAll("'", "''")}'`).join(",");
const parcelScope = [
  borough ? `p.borough='${borough.replaceAll("'", "''")}'` : null,
  locality ? `p.locality='${locality.replaceAll("'", "''")}'` : null,
].filter(Boolean);
const query = `
  WITH impact AS (
    SELECT document_id,
      count(DISTINCT parcel_id) AS candidate_parcels,
      count(DISTINCT CASE WHEN is_controlling=1 THEN parcel_id END) AS controlling_parcels
    FROM parcel_planning_segments ps
    JOIN parcels p ON p.id=ps.parcel_id
    ${parcelScope.length ? `WHERE ${parcelScope.join(" AND ")}` : ""}
    GROUP BY document_id
  )
  SELECT d.plan_key,a.url,a.asset_type,a.retrieval_status,
    coalesce(i.controlling_parcels,0) AS controlling_parcels,
    coalesce(i.candidate_parcels,0) AS candidate_parcels
  FROM planning_document_assets a
  JOIN planning_documents d ON d.id=a.document_id
  LEFT JOIN impact i ON i.document_id=d.id
  WHERE a.asset_type IN (${quotedTypes})
    AND a.retrieval_status IN (${quotedStatuses})
    ${parcelScope.length ? "AND coalesce(i.candidate_parcels,0)>0" : ""}
  ORDER BY controlling_parcels DESC,candidate_parcels DESC,d.plan_key,a.asset_type
  LIMIT ${limit}`;
const selected = JSON.parse(execFileSync("sqlite3", ["-json", database, query], { encoding: "utf8" }) || "[]");
const inventory = new Map(fs.readFileSync(input, "utf8").split("\n").filter(Boolean).map((line) => { const row = JSON.parse(line); return [row.url, row]; }));
const rows = selected.map((item, index) => {
  const row = inventory.get(item.url);
  if (!row) throw new Error(`Priority asset is absent from inventory: ${item.url}`);
  return { ...row, priorityRank: index + 1, controllingParcels: item.controlling_parcels, candidateParcels: item.candidate_parcels, priorRetrievalStatus: item.retrieval_status };
});
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
console.log(JSON.stringify({ assets: rows.length, types, statuses, borough: borough || null, locality: locality || null, controllingParcelsCovered: rows.reduce((sum, row) => sum + row.controllingParcels, 0), candidateParcelsCovered: rows.reduce((sum, row) => sum + row.candidateParcels, 0), output }));
