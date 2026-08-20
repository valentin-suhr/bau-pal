#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { execFileSync, spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { localD1Path } from "./local-d1-path.mjs";

function option(name, fallback) { const p = `--${name}=`; return process.argv.find((v) => v.startsWith(p))?.slice(p.length) ?? fallback; }
const locality = option("locality", "").trim();
if (locality && !/^[\p{L}\p{N} .()'\-/]+$/u.test(locality)) throw new Error("locality contains unsupported characters");
const localitySql = locality ? `'${locality.replaceAll("'", "''")}'` : null;

const QUERY = `
WITH line_summary AS (
  SELECT ppl.parcel_id, count(*) AS line_count,
    sum(CASE WHEN ppl.relation IN ('intersects','touches') THEN 1 ELSE 0 END) AS exact_count,
    sum(CASE WHEN ppl.relation='within_tolerance' THEN 1 ELSE 0 END) AS tolerance_count,
    min(ppl.distance_m) AS nearest_distance_m, max(ppl.distance_m) AS maximum_distance_m,
    json_group_array(DISTINCT ppl.relation) AS relations_json,
    json_group_array(DISTINCT plf.line_type) AS types_json,
    json_group_array(DISTINCT plf.approval_kind) FILTER (WHERE plf.approval_kind IS NOT NULL AND plf.approval_kind!='') AS approval_kinds_json,
    json_group_array(DISTINCT plf.official_id) AS official_ids_json,
    min(plf.approval_date) AS earliest_approval_date,
    max(coalesce(plf.approval_date_end,plf.approval_date)) AS latest_approval_date,
    max(plf.source_updated_at) AS source_updated_at, min(plf.source_id) AS source_id
  FROM parcel_planning_lines ppl JOIN planning_line_features plf ON plf.id=ppl.line_id
  GROUP BY ppl.parcel_id
), zone_rule_summary AS (
  SELECT z.id AS zone_id,
    max(CASE WHEN pr.rule_type='land_use' THEN pr.text_value END) AS land_use_code,
    max(CASE WHEN pr.rule_type='permitted_uses' THEN pr.text_value END) AS permitted_uses_json,
    max(CASE WHEN pr.rule_type='floor_area_max_sqm' THEN pr.numeric_value END) AS project_floor_area_cap_sqm,
    max(CASE WHEN pr.rule_type='absolute_elevation_max_m' THEN pr.numeric_value END) AS absolute_elevation_max_m_nhn,
    max(CASE WHEN pr.rule_type IN ('land_use','permitted_uses','floor_area_max_sqm','absolute_elevation_max_m') THEN pr.source_locator END) AS rule_source_locator,
    max(CASE WHEN pr.rule_type IN ('land_use','permitted_uses','floor_area_max_sqm','absolute_elevation_max_m') THEN pr.review_status END) AS rule_review_status,
    json_group_array(json_object(
      'ruleType',pr.rule_type,'numericValue',pr.numeric_value,'textValue',pr.text_value,
      'unit',pr.unit,'legalCitation',pr.legal_citation,'interpretation',pr.interpretation,
      'confidence',pr.confidence,'reviewStatus',pr.review_status,'sourceLocator',pr.source_locator
    )) FILTER (WHERE pr.id IS NOT NULL) AS rules_json
  FROM planning_zones z LEFT JOIN planning_rules pr ON pr.zone_id=z.id AND pr.applicability='zone_rule'
  WHERE z.geometry_method='georeferenced_scan'
  GROUP BY z.id
), internal_zone_summary AS (
  SELECT ps.parcel_id,json_group_array(json_object(
      'planKey',pd.plan_key,'zoneKey',z.zone_key,'label',z.label,
      'coverageRatio',ps.coverage_ratio,'intersectionAreaSqm',ps.intersection_area_sqm,
      'landUseCode',zrs.land_use_code,'geometryConfidence',z.confidence,
      'geometryReviewStatus',zr.review_status,'rmsResidualM',zr.rms_residual_m,
      'scopePartitionComplete',dzr.scope_partition_complete,'landUseComplete',dzr.land_use_complete,
      'densityComplete',dzr.density_complete,'heightComplete',dzr.height_complete,
      'buildingFormComplete',dzr.building_form_complete,'otherConstraintsComplete',dzr.other_constraints_complete,
      'rules',json(coalesce(zrs.rules_json,'[]'))
    )) AS zones_json,
    sum(CASE WHEN zrs.land_use_code IS NOT NULL AND ps.coverage_ratio>=0.05 THEN 1 ELSE 0 END) AS material_land_use_zone_count
  FROM parcel_planning_segments ps
  JOIN planning_documents pd ON pd.id=ps.document_id
  JOIN planning_zones z ON z.id=ps.zone_id AND z.geometry_method='georeferenced_scan'
  LEFT JOIN planning_zone_geometry_reviews zr ON zr.zone_id=z.id
  LEFT JOIN planning_document_zone_reviews dzr ON dzr.document_id=pd.id
  LEFT JOIN zone_rule_summary zrs ON zrs.zone_id=z.id
  GROUP BY ps.parcel_id
), dominant_land_use_candidates AS (
  SELECT ps.parcel_id,pd.plan_key,z.zone_key,z.label,zrs.land_use_code,
    ps.coverage_ratio,z.confidence,zrs.permitted_uses_json,
    zrs.project_floor_area_cap_sqm,zrs.absolute_elevation_max_m_nhn,
    zrs.rule_source_locator,zrs.rule_review_status
  FROM parcel_planning_segments ps
  JOIN planning_documents pd ON pd.id=ps.document_id
  JOIN planning_zones z ON z.id=ps.zone_id AND z.geometry_method='georeferenced_scan'
  JOIN planning_document_zone_reviews dzr ON dzr.document_id=pd.id AND dzr.land_use_complete=1 AND dzr.review_status='manually_verified'
  JOIN zone_rule_summary zrs ON zrs.zone_id=z.id AND zrs.land_use_code IS NOT NULL
  WHERE ps.coverage_ratio>=0.95 AND EXISTS (
    SELECT 1 FROM parcel_planning_segments controlling
    WHERE controlling.parcel_id=ps.parcel_id AND controlling.document_id=ps.document_id AND controlling.is_controlling=1
  )
), dominant_land_use_summary AS (
  SELECT parcel_id,min(plan_key) AS plan_key,min(zone_key) AS zone_key,min(label) AS label,
    min(land_use_code) AS land_use_code,min(coverage_ratio) AS coverage_ratio,
    min(confidence) AS confidence,min(permitted_uses_json) AS permitted_uses_json,
    min(project_floor_area_cap_sqm) AS project_floor_area_cap_sqm,
    min(absolute_elevation_max_m_nhn) AS absolute_elevation_max_m_nhn,
    min(rule_source_locator) AS rule_source_locator,min(rule_review_status) AS rule_review_status
  FROM dominant_land_use_candidates GROUP BY parcel_id HAVING count(*)=1
), document_rule_rows AS (
  SELECT DISTINCT ps.parcel_id,pr.id,pd.plan_key,pr.rule_type,pr.numeric_value,pr.text_value,
    pr.unit,pr.legal_citation,pr.interpretation,pr.confidence,pr.review_status,pr.source_locator
  FROM parcel_planning_segments ps
  JOIN planning_rules pr ON pr.document_id=ps.document_id AND pr.applicability='document_rule'
  JOIN planning_documents pd ON pd.id=pr.document_id
), document_rule_summary AS (
  SELECT parcel_id,json_group_array(json_object(
      'planKey',plan_key,'ruleType',rule_type,'numericValue',numeric_value,
      'textValue',text_value,'unit',unit,'legalCitation',legal_citation,
      'interpretation',interpretation,'confidence',confidence,
      'reviewStatus',review_status,'sourceLocator',source_locator
    )) AS rules_json
  FROM document_rule_rows GROUP BY parcel_id
), legal_effect_summary AS (
  SELECT p.id AS parcel_id,pd.plan_key,pr.text_value AS legal_effect,
    pr.legal_citation,pr.interpretation,pr.confidence,pr.review_status,
    pr.source_locator,s.title AS source_title,s.url AS source_url,
    s.retrieved_at AS source_retrieved_at
  FROM parcels p
  JOIN planning_zones z ON z.geometry_method='judgment_current_cadastral_match_v1'
    AND z.geometry_geojson=p.geometry_geojson
  JOIN planning_documents pd ON pd.id=z.document_id
  JOIN planning_rules pr ON pr.zone_id=z.id AND pr.applicability='zone_rule'
    AND pr.rule_type='legal_effect'
  LEFT JOIN sources s ON s.id=pr.source_id
)
SELECT
  p.id AS parcel_id,
  p.cadastral_district, p.flur, p.numerator, p.denominator,
  p.borough, p.locality, p.area_sqm,
  p.centroid_lng, p.centroid_lat,
  p.bbox_west, p.bbox_south, p.bbox_east, p.bbox_north,
  p.geometry_geojson,
  j.historical_sector, j.workflow AS planning_workflow,
  j.reason AS workflow_reason, j.assignment_method AS workflow_method,
  j.confidence AS workflow_confidence, j.source_locator AS workflow_source_locator,
  json_extract(j.evidence_json,'$.historicalBoundaryCheck') AS historical_boundary_check,
  json_extract(j.evidence_json,'$.historicalBoundaryCandidate') AS historical_boundary_candidate,
  json_extract(j.evidence_json,'$.historicalBoundaryDistanceM') AS historical_boundary_distance_m,
  json_extract(j.evidence_json,'$.historicalBoundaryReview') AS historical_boundary_review,
  js.title AS workflow_source_title, js.url AS workflow_source_url,
  js.retrieved_at AS workflow_source_retrieved_at, j.updated_at AS workflow_updated_at,
  d.primary_regime AS legal_regime, d.legal_basis,
  d.controlling_plan_keys_json,
  (SELECT json_group_array(plan_key) FROM (
    SELECT DISTINCT pd.plan_key AS plan_key
    FROM parcel_planning_segments ps JOIN planning_documents pd ON pd.id=ps.document_id
    WHERE ps.parcel_id=p.id ORDER BY pd.plan_key
  )) AS candidate_plan_keys_json,
  le.plan_key AS partial_invalidity_plan_key,
  le.legal_effect AS partial_invalidity_legal_effect,
  le.legal_citation AS partial_invalidity_legal_citation,
  le.interpretation AS partial_invalidity_interpretation,
  le.confidence AS partial_invalidity_confidence,
  le.review_status AS partial_invalidity_review_status,
  le.source_locator AS partial_invalidity_source_locator,
  le.source_title AS partial_invalidity_source_title,
  le.source_url AS partial_invalidity_source_url,
  le.source_retrieved_at AS partial_invalidity_source_retrieved_at,
  coalesce(iz.zones_json,'[]') AS bplan_internal_zones_json,
  coalesce(dr.rules_json,'[]') AS bplan_document_rules_json,
  coalesce(iz.material_land_use_zone_count,0) AS bplan_material_internal_land_use_zone_count,
  dl.plan_key AS bplan_dominant_zone_plan_key,
  dl.zone_key AS bplan_dominant_zone_key,
  dl.land_use_code AS bplan_dominant_land_use_code,
  dl.label AS bplan_dominant_land_use_label,
  dl.coverage_ratio AS bplan_dominant_zone_coverage_ratio,
  dl.confidence AS bplan_dominant_zone_confidence,
  dl.permitted_uses_json AS bplan_dominant_permitted_uses_json,
  dl.project_floor_area_cap_sqm AS bplan_dominant_zone_project_floor_area_cap_sqm,
  dl.absolute_elevation_max_m_nhn AS bplan_dominant_zone_absolute_elevation_max_m_nhn,
  dl.rule_source_locator AS bplan_dominant_zone_rule_source_locator,
  dl.rule_review_status AS bplan_dominant_zone_rule_review_status,
  d.permitted_uses_json AS legal_permitted_uses_json,
  (SELECT json_group_array(text_value) FROM (
    SELECT DISTINCT r.text_value AS text_value
    FROM parcel_planning_segments ps JOIN planning_rules r ON r.document_id=ps.document_id
    WHERE ps.parcel_id=p.id AND ps.is_controlling=1
      AND r.applicability='document_summary' AND r.rule_type='land_use'
    ORDER BY r.text_value
  )) AS candidate_plan_land_uses_json,
  (SELECT count(*) FROM parcel_planning_segments ps
    JOIN planning_rules pr ON pr.document_id=ps.document_id
    WHERE ps.parcel_id=p.id AND ps.is_controlling=1
      AND pr.extraction_method IN ('embedded_text_mention','ocr')) AS bplan_text_mention_count,
  (SELECT CASE WHEN count(DISTINCT pr.numeric_value)=1 THEN min(pr.numeric_value) END
    FROM parcel_planning_segments ps JOIN planning_rules pr ON pr.document_id=ps.document_id
    WHERE ps.parcel_id=p.id AND ps.is_controlling=1 AND pr.rule_type='grz'
      AND pr.extraction_method IN ('embedded_text_mention','ocr')) AS bplan_candidate_grz,
  (SELECT CASE WHEN count(DISTINCT pr.numeric_value)=1 THEN min(pr.numeric_value) END
    FROM parcel_planning_segments ps JOIN planning_rules pr ON pr.document_id=ps.document_id
    WHERE ps.parcel_id=p.id AND ps.is_controlling=1 AND pr.rule_type='gfz'
      AND pr.extraction_method IN ('embedded_text_mention','ocr')) AS bplan_candidate_gfz,
  (SELECT CASE WHEN count(DISTINCT pr.numeric_value)=1 THEN min(pr.numeric_value) END
    FROM parcel_planning_segments ps JOIN planning_rules pr ON pr.document_id=ps.document_id
    WHERE ps.parcel_id=p.id AND ps.is_controlling=1 AND pr.rule_type='storeys_max'
      AND pr.extraction_method IN ('embedded_text_mention','ocr')) AS bplan_candidate_storeys_max,
  (SELECT CASE WHEN count(DISTINCT pr.text_value)=1 THEN min(pr.text_value) END
    FROM parcel_planning_segments ps JOIN planning_rules pr ON pr.document_id=ps.document_id
    WHERE ps.parcel_id=p.id AND ps.is_controlling=1 AND pr.rule_type='building_form'
      AND pr.extraction_method IN ('embedded_text_mention','ocr')) AS bplan_candidate_building_form,
  (SELECT json_group_array(text_value) FROM (
    SELECT DISTINCT pr.text_value
    FROM parcel_planning_segments ps JOIN planning_rules pr ON pr.document_id=ps.document_id
    WHERE ps.parcel_id=p.id AND ps.is_controlling=1 AND pr.rule_type='land_use'
      AND pr.extraction_method IN ('embedded_text_mention','ocr')
    ORDER BY pr.text_value
  )) AS bplan_candidate_land_uses_json,
  (SELECT count(*) FROM parcel_planning_segments ps JOIN planning_document_assets a ON a.document_id=ps.document_id AND a.asset_type='plan_sheet' WHERE ps.parcel_id=p.id AND ps.is_controlling=1) AS bplan_plan_sheet_total,
  (SELECT count(*) FROM parcel_planning_segments ps JOIN planning_document_assets a ON a.document_id=ps.document_id AND a.asset_type='plan_sheet' AND a.retrieval_status='downloaded' WHERE ps.parcel_id=p.id AND ps.is_controlling=1) AS bplan_plan_sheet_downloaded,
  (SELECT count(*) FROM parcel_planning_segments ps JOIN planning_document_assets a ON a.document_id=ps.document_id AND a.asset_type='plan_sheet' AND a.extraction_status IN ('machine_extracted','verified') WHERE ps.parcel_id=p.id AND ps.is_controlling=1) AS bplan_plan_sheet_extracted,
  (SELECT max(a.retrieved_at) FROM parcel_planning_segments ps JOIN planning_document_assets a ON a.document_id=ps.document_id AND a.asset_type='plan_sheet' WHERE ps.parcel_id=p.id AND ps.is_controlling=1) AS bplan_plan_sheet_latest_retrieved_at,
  d.legal_land_use_code, d.legal_land_use_label,
  d.legal_grz, d.legal_gfz, d.legal_storeys_min, d.legal_storeys_max,
  d.legal_height_max_m, d.building_form AS legal_building_form,
  CASE
    WHEN d.legal_land_use_code IS NOT NULL AND d.permitted_uses_json!='[]' AND d.legal_grz IS NOT NULL AND d.legal_gfz IS NOT NULL AND d.legal_storeys_max IS NOT NULL AND d.building_form IS NOT NULL THEN 'complete'
    WHEN d.legal_land_use_code IS NOT NULL OR d.permitted_uses_json!='[]' OR d.legal_grz IS NOT NULL OR d.legal_gfz IS NOT NULL OR d.legal_storeys_max IS NOT NULL OR d.building_form IS NOT NULL THEN 'partial'
    ELSE 'unresolved' END AS core_completeness,
  d.max_principal_footprint_sqm, d.max_legal_floor_area_sqm,
  d.other_constraints_json, d.resolution_confidence, d.review_status,
  d.unresolved_fields_json, d.resolved_at, d.notes AS profile_notes,
  CASE WHEN json_valid(d.notes) THEN json_extract(d.notes,'$.resolutionMethod') END AS profile_resolution_method,
  bo.text_value AS bnp_baustufe_candidate,
  bo.confidence AS bnp_baustufe_confidence,
  bo.source_locator AS bnp_baustufe_source_locator,
  bo.evidence_json AS bnp_baustufe_evidence_json,
  lo.text_value AS bnp_land_use_code,
  CASE lo.text_value
    WHEN 'village_or_pure_residential' THEN 'Dorfgebiet oder reines Wohngebiet'
    WHEN 'general_residential' THEN 'Allgemeines Wohngebiet'
    WHEN 'mixed' THEN 'Gemischtes Gebiet'
    WHEN 'restricted_work' THEN 'Beschränktes Arbeitsgebiet'
    WHEN 'pure_work' THEN 'Reines Arbeitsgebiet'
    WHEN 'core' THEN 'Kerngebiet'
    WHEN 'land_reserve' THEN 'Baulandreserve'
    WHEN 'special_purpose' THEN 'Besondere Zweckbestimmung'
    WHEN 'non_build_or_forest' THEN 'Nichtbaugebiet oder Waldgebiet'
  END AS bnp_land_use_candidate,
  lo.confidence AS bnp_land_use_confidence,
  CASE WHEN lo.text_value IN ('village_or_pure_residential','non_build_or_forest') THEN 1 ELSE 0 END AS bnp_land_use_ambiguous,
  json_extract(lo.evidence_json,'$.sampleAgreement') AS bnp_land_use_sample_agreement,
  json_extract(lo.evidence_json,'$.classifiedPixelShare') AS bnp_land_use_classified_pixel_share,
  lo.source_locator AS bnp_land_use_source_locator,
  ls.title AS bnp_land_use_source_title, ls.url AS bnp_land_use_source_url,
  ls.retrieved_at AS bnp_land_use_source_retrieved_at,
  (SELECT numeric_value FROM planning_codebook_entries c WHERE c.codebook_key='bnp_baustufe' AND c.code=bo.text_value AND c.rule_type='grz') AS bnp_candidate_grz,
  (SELECT numeric_value FROM planning_codebook_entries c WHERE c.codebook_key='bnp_baustufe' AND c.code=bo.text_value AND c.rule_type='gfz') AS bnp_candidate_gfz,
  (SELECT numeric_value FROM planning_codebook_entries c WHERE c.codebook_key='bnp_baustufe' AND c.code=bo.text_value AND c.rule_type='storeys_max') AS bnp_candidate_storeys_max,
  (SELECT numeric_value FROM planning_codebook_entries c WHERE c.codebook_key='bnp_baustufe' AND c.code=bo.text_value AND c.rule_type='bmz') AS bnp_candidate_bmz,
  (SELECT text_value FROM planning_codebook_entries c WHERE c.codebook_key='bnp_baustufe' AND c.code=bo.text_value AND c.rule_type='building_form') AS bnp_candidate_building_form,
  (SELECT numeric_value FROM planning_codebook_entries c WHERE c.codebook_key='bnp_baustufe' AND c.code=bo.text_value AND c.rule_type='height_max_m') AS bnp_candidate_height_max_m,
  CASE
    WHEN lo.text_value='general_residential' AND (SELECT text_value FROM planning_codebook_entries c WHERE c.codebook_key='bnp_baustufe' AND c.code=bo.text_value AND c.rule_type='building_form')='open' THEN 20
    WHEN lo.text_value='general_residential' AND (SELECT text_value FROM planning_codebook_entries c WHERE c.codebook_key='bnp_baustufe' AND c.code=bo.text_value AND c.rule_type='building_form')='closed' THEN 13
    WHEN lo.text_value='mixed' THEN 20 WHEN lo.text_value='core' THEN 30 END AS bnp_candidate_building_depth_m,
  (SELECT text_value FROM planning_codebook_entries c WHERE c.codebook_key='bnp_land_use_permitted_use' AND c.code=lo.text_value AND c.rule_type='land_use') AS bnp_permitted_uses_candidate_json,
  bs.title AS bnp_rule_source_title, bs.url AS bnp_rule_source_url, bs.retrieved_at AS bnp_rule_source_retrieved_at,
  CASE WHEN bo.text_value IS NULL THEN NULL ELSE round(p.area_sqm*(SELECT numeric_value FROM planning_codebook_entries c WHERE c.codebook_key='bnp_baustufe' AND c.code=bo.text_value AND c.rule_type='grz'),2) END AS bnp_candidate_footprint_sqm,
  CASE WHEN bo.text_value IS NULL THEN NULL ELSE round(p.area_sqm*(SELECT numeric_value FROM planning_codebook_entries c WHERE c.codebook_key='bnp_baustufe' AND c.code=bo.text_value AND c.rule_type='gfz'),2) END AS bnp_candidate_floor_area_sqm,
  fo.text_value AS fnp_land_use_candidate,
  fo.confidence AS fnp_confidence, fo.source_locator AS fnp_source_locator,
  json_extract(fo.evidence_json,'$.sourceUpdatedAt') AS fnp_source_updated_at,
  fs.url AS fnp_source_url, fs.retrieved_at AS fnp_source_retrieved_at,
  CASE WHEN fo.text_value LIKE 'Wohnbaufläche, W1%' THEN 1.5 END AS fnp_gfz_band_min,
  CASE WHEN fo.text_value LIKE 'Wohnbaufläche, W2%' THEN 1.5 WHEN fo.text_value LIKE 'Wohnbaufläche, W3%' THEN 0.8 WHEN fo.text_value LIKE 'Wohnbaufläche, W4%' THEN 0.4 END AS fnp_gfz_band_max,
  ro.text_value AS legal_regime_candidate,
  ro.confidence AS legal_regime_candidate_confidence,
  ro.source_locator AS legal_regime_candidate_source_locator,
  ro.evidence_json AS legal_regime_candidate_evidence_json,
  json_extract(sc.evidence_json,'$.within50m') AS context_buildings_within_50m,
  json_extract(sc.evidence_json,'$.within100m') AS context_buildings_within_100m,
  json_extract(sc.evidence_json,'$.nearestBuildingDistanceM') AS context_nearest_building_m,
  json_extract(sc.evidence_json,'$.medianObservedStoreys100m') AS context_median_storeys_100m,
  json_extract(sc.evidence_json,'$.observedStoreySampleSize') AS context_storey_sample_size,
  json_extract(sc.evidence_json,'$.parcelBuildingCentres') AS parcel_building_centres,
  json_extract(sc.evidence_json,'$.parcelBuildingFootprintSqm') AS parcel_building_footprint_sqm,
  round(json_extract(sc.evidence_json,'$.parcelBuildingFootprintSqm')/nullif(p.area_sqm,0),6) AS apparent_building_footprint_share,
  json_extract(sc.evidence_json,'$.occupancyScreening') AS occupancy_screening,
  sc.confidence AS occupancy_screening_confidence,
  sc.source_locator AS occupancy_source_locator,
  ss.title AS occupancy_source_title, ss.url AS occupancy_source_url,
  ss.retrieved_at AS occupancy_source_retrieved_at,
  json_extract(cap.evidence_json,'$.occupancyScreening') AS capacity_occupancy_screening,
  json_extract(cap.evidence_json,'$.observedFootprintSqm') AS observed_building_footprint_sqm,
  json_extract(cap.evidence_json,'$.estimatedFloorAreaSqm') AS estimated_observed_floor_area_sqm,
  json_extract(cap.evidence_json,'$.observedStoreysMax') AS observed_storeys_max,
  json_extract(cap.evidence_json,'$.storeyFootprintCoverage') AS observed_storey_footprint_coverage,
  json_extract(cap.evidence_json,'$.apparentGrz') AS apparent_grz,
  json_extract(cap.evidence_json,'$.apparentGfz') AS apparent_gfz,
  round(json_extract(cap.evidence_json,'$.apparentGrz')/nullif(d.legal_grz,0),6) AS indicative_grz_utilization,
  round(json_extract(cap.evidence_json,'$.apparentGfz')/nullif(d.legal_gfz,0),6) AS indicative_gfz_utilization,
  round(json_extract(cap.evidence_json,'$.observedStoreysMax')/nullif(d.legal_storeys_max,0),6) AS indicative_storey_utilization,
  CASE WHEN cap.id IS NULL OR d.max_principal_footprint_sqm IS NULL THEN NULL ELSE max(0,round(d.max_principal_footprint_sqm-json_extract(cap.evidence_json,'$.observedFootprintSqm'),2)) END AS indicative_remaining_footprint_sqm,
  CASE WHEN cap.id IS NULL OR d.max_legal_floor_area_sqm IS NULL THEN NULL ELSE max(0,round(d.max_legal_floor_area_sqm-json_extract(cap.evidence_json,'$.estimatedFloorAreaSqm'),2)) END AS indicative_remaining_floor_area_sqm,
  cap.confidence AS capacity_screening_confidence,
  cap.review_status AS capacity_review_status,
  cap.extraction_method AS capacity_extraction_method,
  cap.source_locator AS capacity_source_locator,
  caps.title AS capacity_source_title, caps.url AS capacity_source_url,
  caps.retrieved_at AS capacity_source_retrieved_at,
  coalesce(lx.line_count,0) AS planning_line_count,
  coalesce(lx.exact_count,0) AS planning_line_exact_count,
  coalesce(lx.tolerance_count,0) AS planning_line_tolerance_count,
  lx.nearest_distance_m AS planning_line_nearest_distance_m,
  lx.maximum_distance_m AS planning_line_maximum_distance_m,
  lx.relations_json AS planning_line_relations_json,
  lx.types_json AS planning_line_types_json,
  lx.approval_kinds_json AS planning_line_approval_kinds_json,
  lx.official_ids_json AS planning_line_official_ids_json,
  lx.earliest_approval_date AS planning_line_earliest_approval_date,
  lx.latest_approval_date AS planning_line_latest_approval_date,
  lx.source_updated_at AS planning_line_source_updated_at,
  CASE WHEN lx.line_count IS NULL THEN NULL WHEN lx.exact_count>0 THEN 'high' ELSE 'medium' END AS planning_line_confidence,
  lxs.title AS planning_line_source_title, lxs.url AS planning_line_source_url,
  lxs.retrieved_at AS planning_line_source_retrieved_at
FROM parcels p
LEFT JOIN parcel_jurisdiction_contexts j ON j.parcel_id=p.id
LEFT JOIN sources js ON js.id=j.source_id
LEFT JOIN parcel_development_profiles d ON d.parcel_id=p.id
LEFT JOIN parcel_planning_observations bo ON bo.parcel_id=p.id AND bo.observation_type='baustufe_candidate' AND bo.extraction_method='raster_opposing_boundary_candidate_v1'
LEFT JOIN parcel_planning_observations lo ON lo.parcel_id=p.id AND lo.observation_type='land_use_candidate' AND lo.extraction_method='raster_colour_candidate_v1' AND j.workflow='baunutzungsplan_stack_candidate'
LEFT JOIN sources ls ON ls.id=lo.source_id
LEFT JOIN sources bs ON bs.source_key='berlin-bo58-continuing'
LEFT JOIN line_summary lx ON lx.parcel_id=p.id
LEFT JOIN sources lxs ON lxs.id=lx.source_id
LEFT JOIN parcel_planning_observations fo ON fo.parcel_id=p.id AND fo.observation_type='fnp_land_use_candidate' AND fo.extraction_method='official_fnp_centroid_overlay_v1'
LEFT JOIN sources fs ON fs.id=fo.source_id
LEFT JOIN parcel_planning_observations ro ON ro.parcel_id=p.id AND ro.observation_type='legal_regime_candidate' AND ro.extraction_method='combined_official_context_screen_v1'
LEFT JOIN parcel_planning_observations sc ON sc.parcel_id=p.id AND sc.observation_type='settlement_context' AND sc.extraction_method='official_building_centroid_metrics'
LEFT JOIN sources ss ON ss.id=sc.source_id
LEFT JOIN parcel_planning_observations cap ON cap.parcel_id=p.id AND cap.observation_type='development_capacity_screen' AND cap.extraction_method='exact_alkis_building_parcel_overlap_v1'
LEFT JOIN sources caps ON caps.id=cap.source_id
LEFT JOIN internal_zone_summary iz ON iz.parcel_id=p.id
LEFT JOIN document_rule_summary dr ON dr.parcel_id=p.id
LEFT JOIN dominant_land_use_summary dl ON dl.parcel_id=p.id
LEFT JOIN legal_effect_summary le ON le.parcel_id=p.id
${localitySql ? `WHERE p.locality=${localitySql}` : ""}
ORDER BY p.id`;

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function main() {
  const database = await localD1Path();
  if (option("validate-only", "false") === "true") {
    execFileSync("sqlite3", [database, `EXPLAIN QUERY PLAN ${QUERY}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    console.log(JSON.stringify({ database, queryValid: true, schemaVersion: "berlin-parcel-table-v2" }));
    return;
  }
  const output = resolve(option("output", "data/exports/berlin-parcels.csv.gz"));
  const manifestPath = resolve(option("manifest", "data/exports/berlin-parcels.manifest.json"));
  const gzip = option("gzip", "true") !== "false";
  await mkdir(dirname(output), { recursive: true });
  const sqlite = spawn("sqlite3", ["-header", "-csv", database, QUERY], { stdio: ["ignore", "pipe", "inherit"] });
  const exitCodePromise = new Promise((done, reject) => {
    sqlite.on("error", reject);
    sqlite.on("close", done);
  });
  const destination = createWriteStream(output);
  if (gzip) await pipeline(sqlite.stdout, createGzip({ level: 9 }), destination);
  else await pipeline(sqlite.stdout, destination);
  const exitCode = await exitCodePromise;
  if (exitCode !== 0) throw new Error(`sqlite3 export exited with ${exitCode}`);
  const file = await stat(output);
  const rowCount = Number(execFileSync("sqlite3", [database, `SELECT count(*) FROM parcels${localitySql ? ` WHERE locality=${localitySql}` : ""}`], { encoding: "utf8" }).trim());
  const coverageSql = `SELECT
    count(*) AS total,
    sum(p.geometry_geojson IS NOT NULL AND p.centroid_lng IS NOT NULL AND p.centroid_lat IS NOT NULL) AS geometry,
    sum(p.borough IS NOT NULL AND p.cadastral_district IS NOT NULL AND p.flur IS NOT NULL) AS location,
    sum(j.parcel_id IS NOT NULL) AS workflow_routed,
    sum(d.primary_regime!='unresolved') AS statutory_regime_resolved,
    sum(d.legal_basis!='unresolved') AS legal_basis_routed,
    sum(d.legal_land_use_code IS NOT NULL AND d.legal_land_use_label IS NOT NULL) AS land_use,
    sum(d.permitted_uses_json!='[]') AS permitted_uses,
    sum(d.legal_grz IS NOT NULL) AS grz,
    sum(d.legal_gfz IS NOT NULL) AS gfz,
    sum(d.legal_storeys_max IS NOT NULL) AS storeys,
    sum(d.building_form IS NOT NULL) AS building_form,
    sum(json_valid(d.other_constraints_json) AND json_valid(d.unresolved_fields_json)) AS constraint_status,
    sum(j.source_id IS NOT NULL AND j.source_locator IS NOT NULL) AS workflow_provenance,
    sum(d.resolution_confidence IS NOT NULL AND d.review_status IS NOT NULL) AS confidence_status,
    sum(d.resolved_at IS NOT NULL) AS update_status,
    sum((d.legal_land_use_code IS NULL AND d.legal_grz IS NULL AND d.legal_gfz IS NULL AND d.legal_storeys_max IS NULL AND d.building_form IS NULL)
      OR (CASE WHEN json_valid(d.notes) THEN json_extract(d.notes,'$.resolutionMethod') IS NOT NULL ELSE 0 END)) AS populated_legal_values_with_resolution_method,
    sum(d.legal_land_use_code IS NOT NULL AND d.permitted_uses_json!='[]' AND d.legal_grz IS NOT NULL AND d.legal_gfz IS NOT NULL AND d.legal_storeys_max IS NOT NULL AND d.building_form IS NOT NULL) AS complete_core_profile
    FROM parcels p
    LEFT JOIN parcel_jurisdiction_contexts j ON j.parcel_id=p.id
    LEFT JOIN parcel_development_profiles d ON d.parcel_id=p.id
    ${localitySql ? `WHERE p.locality=${localitySql}` : ""}`;
  const [coverage] = JSON.parse(execFileSync("sqlite3", ["-json", database, coverageSql], { encoding: "utf8" }) || "[]");
  const coverageChecks = {
    rowCountMatches: coverage.total === rowCount,
    rowFoundationComplete: ["geometry", "location", "workflow_routed", "constraint_status", "workflow_provenance", "confidence_status", "update_status"].every((field) => coverage[field] === rowCount),
    populatedLegalValuesHaveResolutionMethod: coverage.populated_legal_values_with_resolution_method === rowCount,
  };
  const manifest = {
    schemaVersion: "berlin-parcel-table-v2",
    generatedAt: new Date().toISOString(),
    rowCount,
    format: gzip ? "CSV compressed with gzip" : "CSV",
    scope: locality ? { locality } : { citywide: true },
    coverage,
    coverageDefinitions: {
      complete_core_profile: "Resolved land use and permitted uses plus legal GRZ, GFZ, maximum storeys and building form.",
      constraint_status: "Both resolved-constraint and unresolved-field arrays are valid JSON; an empty resolved-constraint array does not prove that no constraints apply.",
      workflow_routed: "A sourced workflow branch exists; it is not necessarily a final statutory regime determination.",
    },
    coverageChecks,
    coveragePass: Object.values(coverageChecks).every(Boolean),
    file: output,
    byteSize: file.size,
    sha256: await sha256(output),
    geometryCrs: "EPSG:4326",
    caveat: "BNP fields marked bnp_strict_raster_bo58_v1 are medium-confidence machine interpretations. B-Plan fields with bplan_manual_* methods are manually reviewed parcel matches and retain stated unresolved single-zone or subarea constraints. Capacity fields are indicative comparisons of exact ALKIS building-footprint overlap and recorded storeys with resolved legal maxima; they are not statutory GRZ/GFZ calculations. None of these fields is an official parcel-specific planning statement.",
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
