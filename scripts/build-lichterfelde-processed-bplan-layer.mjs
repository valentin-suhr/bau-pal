import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { localD1Path } from "./local-d1-path.mjs";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(field); field = ""; }
    else if (character === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (character !== "\r") field += character;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [headers, ...values] = rows.filter((candidate) => candidate.length > 1);
  return values.map((candidate) => Object.fromEntries(headers.map((header, index) => [header, candidate[index] ?? ""])));
}

const csvPath = resolve("data/exports/lichterfelde-relevant-bplans.csv");
const outputPath = resolve("public/data/lichterfelde-processed-bplans.geojson");
const processedRows = parseCsv(readFileSync(csvPath, "utf8"))
  .filter((row) => ["machine_extracted", "verified"].includes(row.extraction_status));

if (!processedRows.length) throw new Error("No processed Lichterfelde B-Plans found in the inventory.");
const planKeys = processedRows.map((row) => row.plan_key);
if (new Set(planKeys).size !== planKeys.length) throw new Error("Duplicate processed plan keys in inventory.");

const quotedKeys = planKeys.map((key) => `'${key.replaceAll("'", "''")}'`).join(",");
const databasePath = await localD1Path();
const query = `
  SELECT d.plan_key, d.title, d.plan_type, d.status, d.effective_from,
         z.geometry_geojson, z.geometry_method, z.confidence
  FROM planning_documents d
  JOIN planning_zones z ON z.document_id = d.id
  WHERE d.plan_key IN (${quotedKeys})
    AND z.geometry_method = 'official_vector'
    AND z.zone_key = d.plan_key || ':scope'
  ORDER BY d.plan_key;
`;
const records = JSON.parse(execFileSync("sqlite3", ["-json", databasePath, query], { encoding: "utf8", maxBuffer: 20_000_000 }) || "[]");
const recordByKey = new Map(records.map((record) => [record.plan_key, record]));
const missing = planKeys.filter((key) => !recordByKey.has(key));
if (missing.length) throw new Error(`Missing official plan scopes: ${missing.join(", ")}`);

const features = processedRows.map((inventory) => {
  const record = recordByKey.get(inventory.plan_key);
  const geometry = JSON.parse(record.geometry_geojson);
  if (!["Polygon", "MultiPolygon"].includes(geometry.type)) throw new Error(`Unsupported geometry for ${inventory.plan_key}: ${geometry.type}`);
  return {
    type: "Feature",
    id: inventory.plan_key,
    properties: {
      planKey: inventory.plan_key,
      title: record.title,
      planType: record.plan_type,
      status: record.status,
      effectiveFrom: record.effective_from,
      processingStatus: inventory.extraction_status,
      ocrStatus: inventory.ocr_status,
      planSheetUrl: inventory.plan_sheet_url,
      intersectingParcels: Number(inventory.intersecting_parcels),
      controllingParcels: Number(inventory.controlling_parcels),
      geometrySource: record.geometry_method,
      geometryConfidence: record.confidence,
    },
    geometry,
  };
});

const collection = {
  type: "FeatureCollection",
  metadata: {
    planCount: features.length,
    definition: "Plan-sheet extraction status is machine_extracted or verified. Boundaries are official Berlin vector plan scopes. Processed does not imply legal verification.",
    inventorySource: "data/exports/lichterfelde-relevant-bplans.csv",
    geometrySource: "Local D1 planning_zones official_vector scope",
  },
  features,
};

writeFileSync(outputPath, `${JSON.stringify(collection)}\n`);
console.log(`Wrote ${features.length} processed B-Plan scopes to ${outputPath}`);
