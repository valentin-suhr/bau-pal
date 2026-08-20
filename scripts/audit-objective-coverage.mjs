#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { localD1Path } from "./local-d1-path.mjs";

const database = await localD1Path();
const query = (sql) => JSON.parse(execFileSync("sqlite3", ["-json", database, sql], { encoding: "utf8" }) || "[]");

const measures = `
  count(*) AS total,
  sum(p.geometry_geojson IS NOT NULL AND p.centroid_lng IS NOT NULL AND p.centroid_lat IS NOT NULL AND p.borough IS NOT NULL) AS geometry_location,
  sum(j.parcel_id IS NOT NULL) AS workflow_routed,
  sum(d.primary_regime!='unresolved') AS statutory_regime_resolved,
  sum(d.legal_basis!='unresolved') AS legal_basis_routed,
  sum(d.legal_land_use_code IS NOT NULL AND d.legal_land_use_label IS NOT NULL) AS land_use,
  sum(d.permitted_uses_json!='[]') AS permitted_uses,
  sum(d.legal_grz IS NOT NULL) AS grz,
  sum(d.legal_gfz IS NOT NULL) AS gfz,
  sum(d.legal_storeys_max IS NOT NULL) AS storeys,
  sum(d.building_form IS NOT NULL) AS building_form,
  sum(json_valid(d.other_constraints_json) AND json_valid(d.unresolved_fields_json)) AS constraint_status_explicit,
  sum(d.resolution_confidence IS NOT NULL AND d.review_status IS NOT NULL AND d.resolved_at IS NOT NULL) AS confidence_update_status,
  sum(d.legal_land_use_code IS NOT NULL AND d.permitted_uses_json!='[]' AND d.legal_grz IS NOT NULL AND d.legal_gfz IS NOT NULL AND d.legal_storeys_max IS NOT NULL AND d.building_form IS NOT NULL) AS complete_core_profile`;
const joins = `FROM parcels p
  LEFT JOIN parcel_jurisdiction_contexts j ON j.parcel_id=p.id
  LEFT JOIN parcel_development_profiles d ON d.parcel_id=p.id`;

const [citywide] = query(`SELECT ${measures} ${joins}`);
const boroughs = query(`SELECT p.borough,${measures} ${joins} GROUP BY p.borough ORDER BY p.borough`);
const workflows = query(`SELECT j.workflow,count(*) AS parcels FROM parcel_jurisdiction_contexts j GROUP BY j.workflow ORDER BY parcels DESC`);

const checks = {
  expectedParcelCount: citywide.total === 403484,
  oneRoutedStatusRowPerParcel: ["geometry_location", "workflow_routed", "constraint_status_explicit", "confidence_update_status"].every((field) => citywide[field] === citywide.total),
  legalCompletenessNotOverclaimed: citywide.complete_core_profile < citywide.total,
};

const report = {
  generatedAt: new Date().toISOString(), database,
  definitions: {
    workflowRouted: "A sourced workflow branch exists; this is not necessarily a final statutory regime determination.",
    legalBasisRouted: "The profile is routed to B-Plan, Baunutzungsplan stack, or another non-unresolved legal basis.",
    completeCoreProfile: "Resolved land use and permitted uses plus non-null legal GRZ, GFZ, maximum storeys, and building form.",
    constraintStatusExplicit: "Constraint and unresolved-field JSON are valid; an empty constraint array is not proof that no constraints apply.",
  },
  citywide, boroughs, workflows, checks,
  pass: Object.values(checks).every(Boolean),
  caveat: "This is a coverage audit of existing rows, not new legal-data processing and not proof of parcel-specific buildability.",
};

console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;
