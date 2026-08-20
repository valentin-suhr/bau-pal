#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { localD1Path } from "./local-d1-path.mjs";

const option = (name, fallback) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const database = await localD1Path();
const locality = option("locality", "Lichterfelde");
const borough = option("borough", "Steglitz-Zehlendorf");
const quoted = (value) => `'${String(value).replaceAll("'", "''")}'`;
const scope = `p.borough=${quoted(borough)} AND p.locality=${quoted(locality)}`;
const screen = `o.observation_type='development_capacity_screen' AND o.extraction_method='exact_alkis_building_parcel_overlap_v1'`;
const scalar = (query) => Number(execFileSync("sqlite3", [database, query], { encoding: "utf8" }).trim());

const counts = {
  parcels: scalar(`SELECT count(*) FROM parcels p WHERE ${scope}`),
  screens: scalar(`SELECT count(*) FROM parcel_planning_observations o JOIN parcels p ON p.id=o.parcel_id WHERE ${scope} AND ${screen}`),
  distinctScreenedParcels: scalar(`SELECT count(DISTINCT o.parcel_id) FROM parcel_planning_observations o JOIN parcels p ON p.id=o.parcel_id WHERE ${scope} AND ${screen}`),
  missingProvenance: scalar(`SELECT count(*) FROM parcel_planning_observations o JOIN parcels p ON p.id=o.parcel_id WHERE ${scope} AND ${screen} AND (o.source_id IS NULL OR o.source_locator IS NULL OR o.review_status!='machine_checked' OR o.confidence NOT IN ('low','medium'))`),
  footprintFormulaErrors: scalar(`SELECT count(*) FROM parcel_planning_observations o JOIN parcels p ON p.id=o.parcel_id WHERE ${scope} AND ${screen} AND abs(json_extract(o.evidence_json,'$.apparentGrz')-json_extract(o.evidence_json,'$.observedFootprintSqm')/p.area_sqm)>(0.000051+0.005/p.area_sqm)`),
  gfzFormulaErrors: scalar(`SELECT count(*) FROM parcel_planning_observations o JOIN parcels p ON p.id=o.parcel_id WHERE ${scope} AND ${screen} AND json_extract(o.evidence_json,'$.storeyFootprintCoverage')>=0.8 AND (json_extract(o.evidence_json,'$.apparentGfz') IS NULL OR abs(json_extract(o.evidence_json,'$.apparentGfz')-json_extract(o.evidence_json,'$.estimatedFloorAreaSqm')/p.area_sqm)>(0.000051+0.005/p.area_sqm))`),
  prematureGfzEstimates: scalar(`SELECT count(*) FROM parcel_planning_observations o JOIN parcels p ON p.id=o.parcel_id WHERE ${scope} AND ${screen} AND json_extract(o.evidence_json,'$.storeyFootprintCoverage')<0.8 AND json_extract(o.evidence_json,'$.apparentGfz') IS NOT NULL`),
  occupancyThresholdErrors: scalar(`SELECT count(*) FROM parcel_planning_observations o JOIN parcels p ON p.id=o.parcel_id WHERE ${scope} AND ${screen} AND ((json_extract(o.evidence_json,'$.observedFootprintSqm')>=1 AND json_extract(o.evidence_json,'$.occupancyScreening')!='building_footprint_detected') OR (json_extract(o.evidence_json,'$.observedFootprintSqm')<1 AND json_extract(o.evidence_json,'$.occupancyScreening')!='no_building_footprint_detected'))`),
  confidenceErrors: scalar(`SELECT count(*) FROM parcel_planning_observations o JOIN parcels p ON p.id=o.parcel_id WHERE ${scope} AND ${screen} AND o.confidence!=CASE WHEN json_extract(o.evidence_json,'$.observedFootprintSqm')=0 OR json_extract(o.evidence_json,'$.storeyFootprintCoverage')>=0.8 THEN 'medium' ELSE 'low' END`),
  possibleVacant: scalar(`SELECT count(*) FROM parcel_planning_observations o JOIN parcels p ON p.id=o.parcel_id WHERE ${scope} AND ${screen} AND json_extract(o.evidence_json,'$.occupancyScreening')='no_building_footprint_detected'`),
  highPotential: scalar(`SELECT count(*) FROM parcel_planning_observations o JOIN parcels p ON p.id=o.parcel_id JOIN parcel_development_profiles d ON d.parcel_id=p.id WHERE ${scope} AND ${screen} AND json_extract(o.evidence_json,'$.occupancyScreening')!='no_building_footprint_detected' AND d.legal_gfz IS NOT NULL AND json_extract(o.evidence_json,'$.apparentGfz') IS NOT NULL AND json_extract(o.evidence_json,'$.apparentGfz')/d.legal_gfz<0.5`),
  moderatePotential: scalar(`SELECT count(*) FROM parcel_planning_observations o JOIN parcels p ON p.id=o.parcel_id JOIN parcel_development_profiles d ON d.parcel_id=p.id WHERE ${scope} AND ${screen} AND json_extract(o.evidence_json,'$.occupancyScreening')!='no_building_footprint_detected' AND d.legal_gfz IS NOT NULL AND json_extract(o.evidence_json,'$.apparentGfz') IS NOT NULL AND json_extract(o.evidence_json,'$.apparentGfz')/d.legal_gfz>=0.5 AND json_extract(o.evidence_json,'$.apparentGfz')/d.legal_gfz<0.8`),
  nearFull: scalar(`SELECT count(*) FROM parcel_planning_observations o JOIN parcels p ON p.id=o.parcel_id JOIN parcel_development_profiles d ON d.parcel_id=p.id WHERE ${scope} AND ${screen} AND json_extract(o.evidence_json,'$.occupancyScreening')!='no_building_footprint_detected' AND d.legal_gfz IS NOT NULL AND json_extract(o.evidence_json,'$.apparentGfz') IS NOT NULL AND json_extract(o.evidence_json,'$.apparentGfz')/d.legal_gfz>=0.8`),
};
counts.unassessed = counts.parcels - counts.possibleVacant - counts.highPotential - counts.moderatePotential - counts.nearFull;
const checks = {
  oneScreenPerParcel: counts.screens === counts.parcels && counts.distinctScreenedParcels === counts.parcels,
  provenanceComplete: counts.missingProvenance === 0,
  footprintFormulaConsistent: counts.footprintFormulaErrors === 0,
  gfzFormulaConsistent: counts.gfzFormulaErrors === 0,
  incompleteStoreyCoverageWithheld: counts.prematureGfzEstimates === 0,
  vacancyThresholdConsistent: counts.occupancyThresholdErrors === 0,
  confidenceConsistent: counts.confidenceErrors === 0,
  categoriesReconcile: counts.possibleVacant + counts.highPotential + counts.moderatePotential + counts.nearFull + counts.unassessed === counts.parcels,
};
const report = { generatedAt: new Date().toISOString(), database, scope: { borough, locality }, counts, checks, pass: Object.values(checks).every(Boolean), caveat: "Physical-capacity screening is indicative and is not a statutory GRZ/GFZ calculation or proof of buildability." };
const output = resolve(option("output", "data/qa/development-capacity-audit.json")); await mkdir(dirname(output), { recursive: true }); await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2)); if (!report.pass) process.exitCode = 1;
