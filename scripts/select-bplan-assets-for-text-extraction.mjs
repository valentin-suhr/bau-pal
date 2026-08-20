#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { localD1Path } from "./local-d1-path.mjs";

const option = (name, fallback) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const limit = Number(option("limit", "100"));
if (!Number.isInteger(limit) || limit <= 0) throw new Error("limit must be a positive integer");
const output = resolve(option("output", "data/import/bplan-assets-text-extraction-queue.ndjson"));
const database = await localD1Path();
const query = `
WITH impact AS (
  SELECT document_id,
    count(DISTINCT CASE WHEN is_controlling=1 THEN parcel_id END) AS controlling_parcels,
    count(DISTINCT parcel_id) AS candidate_parcels
  FROM parcel_planning_segments GROUP BY document_id
)
SELECT d.plan_key AS planKey,a.asset_type AS assetType,a.url,
  a.mime_type AS mimeType,a.content_hash_sha256 AS contentHashSha256,
  a.byte_size AS byteSize,a.page_count AS pageCount,
  a.source_modified_at AS sourceModifiedAt,a.retrieved_at AS retrievedAt,
  a.retrieval_status AS retrievalStatus,a.local_path AS localPath,
  a.ocr_status AS ocrStatus,a.extraction_status AS extractionStatus,
  a.extraction_version AS extractionVersion,a.error,a.metadata_json AS metadataJson,
  coalesce(i.controlling_parcels,0) AS controllingParcels,
  coalesce(i.candidate_parcels,0) AS candidateParcels
FROM planning_document_assets a
JOIN planning_documents d ON d.id=a.document_id
LEFT JOIN impact i ON i.document_id=d.id
WHERE a.asset_type='plan_sheet' AND a.retrieval_status='downloaded'
  AND a.mime_type='application/pdf'
  AND a.extraction_status='pending'
ORDER BY controllingParcels DESC,candidateParcels DESC,d.plan_key
LIMIT ${limit}`;
const rows = JSON.parse(execFileSync("sqlite3", ["-json", database, query], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }) || "[]")
  .map(({ metadataJson, ...row }) => ({ ...row, metadata: JSON.parse(metadataJson || "{}") }));
await mkdir(dirname(output), { recursive: true });
await writeFile(output, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
console.log(JSON.stringify({ assets: rows.length, controllingParcelsCovered: rows.reduce((sum, row) => sum + row.controllingParcels, 0), output }));
