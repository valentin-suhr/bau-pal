#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { localD1Path } from "./local-d1-path.mjs";

const database = await localD1Path();
const query = (statement) => execFileSync("sqlite3", [database, statement], { encoding: "utf8" }).trim();
const scalar = (statement) => Number(query(statement) || 0);
const scope = "p.borough='Steglitz-Zehlendorf' AND p.locality='Lichterfelde'";
const screen = "o.observation_type='land_use_eligibility_screen' AND o.extraction_method='qgis_exact_polygon_overlap_v1'";
const counts = {
  parcels: scalar(`SELECT count(*) FROM parcels p WHERE ${scope}`),
  screens: scalar(`SELECT count(*) FROM parcel_planning_observations o JOIN parcels p ON p.id=o.parcel_id WHERE ${scope} AND ${screen}`),
  distinctScreenedParcels: scalar(`SELECT count(DISTINCT o.parcel_id) FROM parcel_planning_observations o JOIN parcels p ON p.id=o.parcel_id WHERE ${scope} AND ${screen}`),
  invalidJson: scalar(`SELECT count(*) FROM parcel_planning_observations o JOIN parcels p ON p.id=o.parcel_id WHERE ${scope} AND ${screen} AND NOT json_valid(o.evidence_json)`),
  invalidShares: scalar(`SELECT count(*) FROM parcel_planning_observations o JOIN parcels p ON p.id=o.parcel_id WHERE ${scope} AND ${screen} AND (json_extract(o.evidence_json,'$.streetOverlapShare') NOT BETWEEN 0 AND 1 OR json_extract(o.evidence_json,'$.parkOverlapShare') NOT BETWEEN 0 AND 1 OR json_extract(o.evidence_json,'$.publicSpaceOverlapShare') NOT BETWEEN 0 AND 1 OR json_extract(o.evidence_json,'$.residentialOverlapShare') NOT BETWEEN 0 AND 1)`),
  street: scalar(`SELECT count(*) FROM parcel_planning_observations o JOIN parcels p ON p.id=o.parcel_id WHERE ${scope} AND ${screen} AND o.text_value='street'`),
  park: scalar(`SELECT count(*) FROM parcel_planning_observations o JOIN parcels p ON p.id=o.parcel_id WHERE ${scope} AND ${screen} AND o.text_value='park'`),
  publicSpace: scalar(`SELECT count(*) FROM parcel_planning_observations o JOIN parcels p ON p.id=o.parcel_id WHERE ${scope} AND ${screen} AND o.text_value='public_space'`),
  residentialCandidate: scalar(`SELECT count(*) FROM parcel_planning_observations o JOIN parcels p ON p.id=o.parcel_id WHERE ${scope} AND ${screen} AND o.text_value='residential_candidate'`),
  otherOrReview: scalar(`SELECT count(*) FROM parcel_planning_observations o JOIN parcels p ON p.id=o.parcel_id WHERE ${scope} AND ${screen} AND o.text_value='other_or_review'`),
  previouslyPossibleVacant: scalar(`SELECT count(*) FROM parcel_planning_observations cap JOIN parcels p ON p.id=cap.parcel_id WHERE ${scope} AND cap.observation_type='development_capacity_screen' AND json_extract(cap.evidence_json,'$.occupancyScreening')='no_building_footprint_detected'`),
  eligibleVacant: scalar(`SELECT count(*) FROM parcel_planning_observations cap JOIN parcels p ON p.id=cap.parcel_id JOIN parcel_planning_observations land ON land.parcel_id=p.id AND land.observation_type='land_use_eligibility_screen' WHERE ${scope} AND cap.observation_type='development_capacity_screen' AND json_extract(cap.evidence_json,'$.occupancyScreening')='no_building_footprint_detected' AND json_extract(land.evidence_json,'$.vacancyEligible')=1`),
  excludedStreetVacant: scalar(`SELECT count(*) FROM parcel_planning_observations cap JOIN parcels p ON p.id=cap.parcel_id JOIN parcel_planning_observations land ON land.parcel_id=p.id AND land.observation_type='land_use_eligibility_screen' WHERE ${scope} AND cap.observation_type='development_capacity_screen' AND json_extract(cap.evidence_json,'$.occupancyScreening')='no_building_footprint_detected' AND land.text_value='street'`),
  excludedParkVacant: scalar(`SELECT count(*) FROM parcel_planning_observations cap JOIN parcels p ON p.id=cap.parcel_id JOIN parcel_planning_observations land ON land.parcel_id=p.id AND land.observation_type='land_use_eligibility_screen' WHERE ${scope} AND cap.observation_type='development_capacity_screen' AND json_extract(cap.evidence_json,'$.occupancyScreening')='no_building_footprint_detected' AND land.text_value='park'`),
};
const classified = counts.street + counts.park + counts.publicSpace + counts.residentialCandidate + counts.otherOrReview;
const checks = {
  oneScreenPerParcel: counts.parcels === counts.screens && counts.screens === counts.distinctScreenedParcels,
  validJson: counts.invalidJson === 0,
  sharesBounded: counts.invalidShares === 0,
  categoriesReconcile: classified === counts.parcels,
  vacancyReduced: counts.eligibleVacant < counts.previouslyPossibleVacant,
};
const result = {
  generatedAt: new Date().toISOString(),
  database,
  scope: { borough: "Steglitz-Zehlendorf", locality: "Lichterfelde" },
  counts,
  checks,
  pass: Object.values(checks).every(Boolean),
  caveat: "Land-use eligibility is a deterministic spatial screen, not a legal buildability determination.",
};
console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exitCode = 1;
