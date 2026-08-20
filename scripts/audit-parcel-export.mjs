#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createGunzip } from "node:zlib";

const archive = resolve(process.argv[2] ?? "data/exports/berlin-parcels.csv.gz");
const manifestPath = resolve(process.argv[3] ?? "data/exports/berlin-parcels.manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const hash = createHash("sha256");
let newlineCount = 0;
let header = "";
let headerComplete = false;
const gunzip = createGunzip();
gunzip.on("data", (chunk) => {
  const text = chunk.toString("utf8");
  newlineCount += text.split("\n").length - 1;
  if (!headerComplete) {
    header += text;
    const index = header.indexOf("\n");
    if (index >= 0) { header = header.slice(0, index); headerComplete = true; }
  }
});
const stream = createReadStream(archive);
stream.on("data", (chunk) => hash.update(chunk));
stream.pipe(gunzip);
await new Promise((done, reject) => { gunzip.on("end", done); gunzip.on("error", reject); stream.on("error", reject); });
const columns = header.split(",");
const required = ["parcel_id", "geometry_geojson", "planning_workflow", "occupancy_screening", "occupancy_screening_confidence", "parcel_building_centres", "parcel_building_footprint_sqm", "occupancy_source_url", "historical_boundary_check", "historical_boundary_distance_m", "historical_boundary_review", "legal_regime", "legal_land_use_code", "legal_land_use_label", "legal_grz", "legal_gfz", "legal_storeys_max", "legal_building_form", "profile_resolution_method", "unresolved_fields_json", "workflow_source_url", "bplan_candidate_grz", "bplan_candidate_land_uses_json", "bplan_plan_sheet_total", "bplan_plan_sheet_downloaded", "bplan_plan_sheet_extracted", "bnp_land_use_candidate", "bnp_baustufe_candidate", "bnp_candidate_building_form", "bnp_candidate_height_max_m", "bnp_candidate_building_depth_m", "bnp_permitted_uses_candidate_json", "fnp_land_use_candidate", "legal_regime_candidate", "planning_line_types_json", "planning_line_relations_json", "planning_line_official_ids_json", "planning_line_source_url", "planning_line_source_updated_at"];
required.push("bplan_internal_zones_json", "bplan_document_rules_json", "bplan_material_internal_land_use_zone_count", "bplan_dominant_zone_key", "bplan_dominant_land_use_code", "bplan_dominant_zone_coverage_ratio", "bplan_dominant_permitted_uses_json", "bplan_dominant_zone_project_floor_area_cap_sqm", "bplan_dominant_zone_absolute_elevation_max_m_nhn");
required.push("partial_invalidity_plan_key", "partial_invalidity_legal_effect", "partial_invalidity_legal_citation", "partial_invalidity_confidence", "partial_invalidity_review_status", "partial_invalidity_source_url", "partial_invalidity_source_retrieved_at");
required.push("capacity_occupancy_screening", "observed_building_footprint_sqm", "estimated_observed_floor_area_sqm", "observed_storeys_max", "observed_storey_footprint_coverage", "apparent_grz", "apparent_gfz", "indicative_grz_utilization", "indicative_gfz_utilization", "indicative_storey_utilization", "indicative_remaining_footprint_sqm", "indicative_remaining_floor_area_sqm", "capacity_screening_confidence", "capacity_review_status", "capacity_extraction_method", "capacity_source_locator", "capacity_source_url", "capacity_source_retrieved_at");
required.push("core_completeness");
const checks = {
  schemaVersion: manifest.schemaVersion === "berlin-parcel-table-v2",
  rowCount: newlineCount - 1 === manifest.rowCount,
  checksum: hash.digest("hex") === manifest.sha256,
  requiredColumns: required.every((column) => columns.includes(column)),
  oneRowPerParcel: manifest.rowCount === 403484,
};
const missingColumns = required.filter((column) => !columns.includes(column));
const pass = Object.values(checks).every(Boolean);
const result = {
  archive, manifestPath, artifactStatus: pass ? "current" : "stale",
  expectedSchemaVersion: "berlin-parcel-table-v2",
  actualSchemaVersion: manifest.schemaVersion,
  dataRows: newlineCount - 1, columnCount: columns.length, missingColumns, checks, pass,
  regenerationCommand: "npm run export:parcels",
};
console.log(JSON.stringify(result, null, 2));
if (!pass) process.exitCode = 1;
