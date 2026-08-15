import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";
const completeCore = "d_filter.legal_land_use_code IS NOT NULL AND d_filter.permitted_uses_json!='[]' AND d_filter.legal_grz IS NOT NULL AND d_filter.legal_gfz IS NOT NULL AND d_filter.legal_storeys_max IS NOT NULL AND d_filter.building_form IS NOT NULL";
const anyCore = "d_filter.legal_land_use_code IS NOT NULL OR d_filter.permitted_uses_json!='[]' OR d_filter.legal_grz IS NOT NULL OR d_filter.legal_gfz IS NOT NULL OR d_filter.legal_storeys_max IS NOT NULL OR d_filter.building_form IS NOT NULL";

function boundedInteger(value: string | null, fallback: number, maximum: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, maximum);
}

function parseBbox(value: string | null) {
  if (!value) return null;
  const parts = value.split(",").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
  const [west, south, east, north] = parts;
  return west < east && south < north ? parts : null;
}

function nonnegativeNumber(value: string | null) {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export async function GET(request: Request) {
  if (!env.DB) {
    return Response.json({ error: "Parcel database is not configured" }, { status: 503 });
  }

  const url = new URL(request.url);
  const bbox = parseBbox(url.searchParams.get("bbox"));
  const borough = url.searchParams.get("borough")?.trim() || null;
  const locality = url.searchParams.get("locality")?.trim() || null;
  const regime = url.searchParams.get("regime")?.trim() || null;
  const workflow = url.searchParams.get("workflow")?.trim() || null;
  const completeness = url.searchParams.get("completeness")?.trim() || null;
  const occupancy = url.searchParams.get("occupancy")?.trim() || null;
  const capacity = url.searchParams.get("capacity")?.trim() || null;
  const heritage = url.searchParams.get("heritage")?.trim() || null;
  const minimumRemainingFloorArea = nonnegativeNumber(url.searchParams.get("minimumRemainingFloorArea"));
  const minimumParcelArea = nonnegativeNumber(url.searchParams.get("minimumParcelArea"));
  const maximumParcelArea = nonnegativeNumber(url.searchParams.get("maximumParcelArea"));
  const residentialOnly = url.searchParams.get("residentialOnly") === "true";
  const sort = url.searchParams.get("sort") === "remainingFloorAreaDesc" ? "remainingFloorAreaDesc" : "default";
  const search = url.searchParams.get("q")?.trim().slice(0, 100) || null;
  const limit = boundedInteger(url.searchParams.get("limit"), 100, 500);
  const offset = boundedInteger(url.searchParams.get("offset"), 0, 1_000_000);

  const where = [];
  const values: Array<string | number> = [];
  if (bbox) {
    const [west, south, east, north] = bbox;
    where.push("p.bbox_east >= ? AND p.bbox_west <= ? AND p.bbox_north >= ? AND p.bbox_south <= ?");
    values.push(west, east, south, north);
  }
  if (borough) {
    where.push("p.borough = ?");
    values.push(borough);
  }
  if (locality) {
    where.push("p.locality = ?");
    values.push(locality);
  }
  if (regime) {
    where.push("EXISTS (SELECT 1 FROM parcel_development_profiles d_filter WHERE d_filter.parcel_id=p.id AND d_filter.primary_regime=?)");
    values.push(regime);
  }
  if (workflow) {
    where.push("EXISTS (SELECT 1 FROM parcel_jurisdiction_contexts j_filter WHERE j_filter.parcel_id=p.id AND j_filter.workflow=?)");
    values.push(workflow);
  }
  if (completeness === "complete") where.push(`EXISTS (SELECT 1 FROM parcel_development_profiles d_filter WHERE d_filter.parcel_id=p.id AND ${completeCore})`);
  else if (completeness === "partial") where.push(`EXISTS (SELECT 1 FROM parcel_development_profiles d_filter WHERE d_filter.parcel_id=p.id AND NOT (${completeCore}) AND (${anyCore}))`);
  else if (completeness === "unresolved") where.push(`EXISTS (SELECT 1 FROM parcel_development_profiles d_filter WHERE d_filter.parcel_id=p.id AND NOT (${anyCore}))`);
  if (occupancy && ["building_footprint_detected", "no_building_footprint_detected"].includes(occupancy)) {
    where.push("EXISTS (SELECT 1 FROM parcel_planning_observations cap_filter WHERE cap_filter.parcel_id=p.id AND cap_filter.observation_type='development_capacity_screen' AND json_extract(cap_filter.evidence_json,'$.occupancyScreening')=?)");
    values.push(occupancy);
  } else if (occupancy && ["building_centre_detected", "no_building_centre_detected"].includes(occupancy)) {
    where.push("EXISTS (SELECT 1 FROM parcel_planning_observations sc_filter WHERE sc_filter.parcel_id=p.id AND sc_filter.observation_type='settlement_context' AND sc_filter.extraction_method='official_building_centroid_metrics' AND json_extract(sc_filter.evidence_json,'$.occupancyScreening')=?)");
    values.push(occupancy);
  }
  if (capacity === "vacant") {
    where.push("EXISTS (SELECT 1 FROM parcel_planning_observations cap_filter WHERE cap_filter.parcel_id=p.id AND cap_filter.observation_type='development_capacity_screen' AND json_extract(cap_filter.evidence_json,'$.occupancyScreening')='no_building_footprint_detected')");
  } else if (["under_50", "between_50_80", "over_80"].includes(capacity ?? "")) {
    const comparison = capacity === "under_50" ? "<0.5" : capacity === "between_50_80" ? ">=0.5 AND json_extract(cap_filter.evidence_json,'$.apparentGfz')/d_filter.legal_gfz<0.8" : ">=0.8";
    where.push(`EXISTS (SELECT 1 FROM parcel_planning_observations cap_filter JOIN parcel_development_profiles d_filter ON d_filter.parcel_id=p.id WHERE cap_filter.parcel_id=p.id AND cap_filter.observation_type='development_capacity_screen' AND json_extract(cap_filter.evidence_json,'$.occupancyScreening')!='no_building_footprint_detected' AND json_extract(cap_filter.evidence_json,'$.apparentGfz') IS NOT NULL AND d_filter.legal_gfz IS NOT NULL AND json_extract(cap_filter.evidence_json,'$.apparentGfz')/d_filter.legal_gfz${comparison})`);
  } else if (capacity === "unassessed") {
    where.push("(NOT EXISTS (SELECT 1 FROM parcel_planning_observations cap_filter WHERE cap_filter.parcel_id=p.id AND cap_filter.observation_type='development_capacity_screen') OR EXISTS (SELECT 1 FROM parcel_planning_observations cap_filter LEFT JOIN parcel_development_profiles d_filter ON d_filter.parcel_id=p.id WHERE cap_filter.parcel_id=p.id AND cap_filter.observation_type='development_capacity_screen' AND json_extract(cap_filter.evidence_json,'$.occupancyScreening')!='no_building_footprint_detected' AND (json_extract(cap_filter.evidence_json,'$.apparentGfz') IS NULL OR d_filter.legal_gfz IS NULL)))");
  }
  if (minimumRemainingFloorArea != null) {
    where.push("EXISTS (SELECT 1 FROM parcel_planning_observations cap_filter JOIN parcel_development_profiles d_filter ON d_filter.parcel_id=p.id WHERE cap_filter.parcel_id=p.id AND cap_filter.observation_type='development_capacity_screen' AND json_extract(cap_filter.evidence_json,'$.apparentGfz') IS NOT NULL AND d_filter.max_legal_floor_area_sqm IS NOT NULL AND d_filter.max_legal_floor_area_sqm-json_extract(cap_filter.evidence_json,'$.estimatedFloorAreaSqm')>=?)");
    values.push(minimumRemainingFloorArea);
  }
  if (residentialOnly) {
    where.push("EXISTS (SELECT 1 FROM parcel_development_profiles d_filter JOIN json_each(d_filter.permitted_uses_json) use_filter WHERE d_filter.parcel_id=p.id AND (lower(use_filter.value) LIKE '%residential%' OR lower(use_filter.value) LIKE '%dwelling%'))");
  }
  if (minimumParcelArea != null) { where.push("p.area_sqm>=?"); values.push(minimumParcelArea); }
  if (maximumParcelArea != null) { where.push("p.area_sqm<=?"); values.push(maximumParcelArea); }
  if (heritage === "direct") where.push("EXISTS (SELECT 1 FROM parcel_heritage_constraints ph_filter WHERE ph_filter.parcel_id=p.id AND ph_filter.relation='direct_overlap')");
  else if (heritage === "nearby") where.push("EXISTS (SELECT 1 FROM parcel_heritage_constraints ph_filter WHERE ph_filter.parcel_id=p.id AND ph_filter.relation='nearby_50m')");
  else if (heritage === "none") where.push("EXISTS (SELECT 1 FROM sources WHERE source_key='berlin-denkmale-wfs') AND NOT EXISTS (SELECT 1 FROM parcel_heritage_constraints ph_filter WHERE ph_filter.parcel_id=p.id)");
  if (search) {
    where.push("(p.id LIKE ? OR p.cadastral_district LIKE ? OR p.locality LIKE ? OR p.borough LIKE ?)");
    const pattern = `%${search}%`;
    values.push(pattern, pattern, pattern, pattern);
  }

  const capacitySortExpression = sort === "remainingFloorAreaDesc"
    ? `(SELECT CASE WHEN json_extract(cap_sort.evidence_json,'$.apparentGfz') IS NOT NULL THEN d_sort.max_legal_floor_area_sqm-json_extract(cap_sort.evidence_json,'$.estimatedFloorAreaSqm') END FROM parcel_development_profiles d_sort LEFT JOIN parcel_planning_observations cap_sort ON cap_sort.parcel_id=d_sort.parcel_id AND cap_sort.observation_type='development_capacity_screen' WHERE d_sort.parcel_id=p.id)`
    : "NULL";

  const query = `
    WITH requested_parcels AS (
      SELECT p.id,${capacitySortExpression} AS capacity_sort_value,
        CASE WHEN d_order.legal_land_use_code IS NOT NULL
          AND d_order.permitted_uses_json!='[]'
          AND d_order.legal_grz IS NOT NULL
          AND d_order.legal_gfz IS NOT NULL
          AND d_order.legal_storeys_max IS NOT NULL
          AND d_order.building_form IS NOT NULL THEN 0 ELSE 1 END AS completeness_order
      FROM parcels p
      LEFT JOIN parcel_development_profiles d_order ON d_order.parcel_id=p.id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY capacity_sort_value DESC,completeness_order,p.id
      LIMIT ? OFFSET ?
    ), line_summary AS (
      SELECT ppl.parcel_id,
        count(*) AS line_count,
        sum(CASE WHEN ppl.relation IN ('intersects','touches') THEN 1 ELSE 0 END) AS exact_count,
        sum(CASE WHEN ppl.relation='within_tolerance' THEN 1 ELSE 0 END) AS tolerance_count,
        min(ppl.distance_m) AS nearest_distance_m,
        max(ppl.distance_m) AS maximum_distance_m,
        json_group_array(DISTINCT ppl.relation) AS relations_json,
        json_group_array(DISTINCT plf.line_type) AS types_json,
        json_group_array(DISTINCT plf.approval_kind) FILTER (WHERE plf.approval_kind IS NOT NULL AND plf.approval_kind!='') AS approval_kinds_json,
        json_group_array(DISTINCT plf.official_id) AS official_ids_json,
        min(plf.approval_date) AS earliest_approval_date,
        max(coalesce(plf.approval_date_end,plf.approval_date)) AS latest_approval_date,
        max(plf.source_updated_at) AS source_updated_at,
        min(plf.source_id) AS source_id
      FROM requested_parcels rp
      JOIN parcel_planning_lines ppl ON ppl.parcel_id=rp.id
      JOIN planning_line_features plf ON plf.id=ppl.line_id
      GROUP BY ppl.parcel_id
    )
    SELECT
      p.id,
      p.numerator,
      p.denominator,
      p.cadastral_district AS cadastralDistrict,
      p.flur,
      p.borough,
      p.locality,
      p.area_sqm AS areaSqm,
      EXISTS (SELECT 1 FROM sources WHERE source_key='berlin-denkmale-wfs') AS heritageAssessed,
      (SELECT json_group_array(json_object(
        'officialId',hf.official_id,'type',hf.monument_type,'detailUrl',hf.detail_url,
        'relation',ph.relation,'distanceM',ph.distance_m,'sourceUpdatedAt',hf.source_updated_at,
        'sourceTitle',hs.title,'sourceUrl',hs.url,'sourceRetrievedAt',hs.retrieved_at
      )) FROM parcel_heritage_constraints ph JOIN heritage_features hf ON hf.official_id=ph.heritage_id LEFT JOIN sources hs ON hs.id=hf.source_id WHERE ph.parcel_id=p.id) AS heritageConstraintsJson,
      p.centroid_lng AS centroidLng,
      p.centroid_lat AS centroidLat,
      p.geometry_geojson AS geometryGeojson,
      json_object(
        'historicalSector',j.historical_sector,
        'planningWorkflow',j.workflow,
        'workflowReason',j.reason,
        'workflowConfidence',j.confidence,
        'workflowAssignmentMethod',j.assignment_method,
        'workflowSourceLocator',j.source_locator,
        'workflowUpdatedAt',j.updated_at,
        'workflowSourceTitle',js.title,
        'workflowSourceUrl',js.url,
        'workflowSourceRetrievedAt',js.retrieved_at,
        'evidence',json(j.evidence_json)
      ) AS workflowJson,
      json_object(
        'primaryRegime',d.primary_regime,
        'legalBasis',d.legal_basis,
        'legalLandUseCode',d.legal_land_use_code,
        'legalLandUseLabel',d.legal_land_use_label,
        'legalGrz',d.legal_grz,
        'legalGfz',d.legal_gfz,
        'legalStoreysMin',d.legal_storeys_min,
        'legalStoreysMax',d.legal_storeys_max,
        'legalHeightMaxM',d.legal_height_max_m,
        'buildingForm',d.building_form,
        'coreCompleteness',CASE
          WHEN d.legal_land_use_code IS NOT NULL AND d.permitted_uses_json!='[]' AND d.legal_grz IS NOT NULL AND d.legal_gfz IS NOT NULL AND d.legal_storeys_max IS NOT NULL AND d.building_form IS NOT NULL THEN 'complete'
          WHEN d.legal_land_use_code IS NOT NULL OR d.permitted_uses_json!='[]' OR d.legal_grz IS NOT NULL OR d.legal_gfz IS NOT NULL OR d.legal_storeys_max IS NOT NULL OR d.building_form IS NOT NULL THEN 'partial'
          ELSE 'unresolved' END,
        'buildingDepthM',d.building_depth_m,
        'roofRules',d.roof_rules,
        'maxPrincipalFootprintSqm',d.max_principal_footprint_sqm,
        'maxLegalFloorAreaSqm',d.max_legal_floor_area_sqm,
        'resolutionConfidence',d.resolution_confidence,
        'reviewStatus',d.review_status
      ) AS profileJson,
      d.controlling_plan_keys_json AS controllingPlanKeysJson,
      d.permitted_uses_json AS permittedUsesJson,
      d.other_constraints_json AS otherConstraintsJson,
      (SELECT json_group_array(value) FROM json_each(d.permitted_uses_json)
        WHERE lower(value) LIKE '%residential%' OR lower(value) LIKE '%dwelling%') AS residentialEligibilityMatchesJson,
      d.unresolved_fields_json AS unresolvedFieldsJson,
      d.notes AS profileNotesJson,
      (SELECT json_group_array(plan_key) FROM (
        SELECT DISTINCT pd.plan_key AS plan_key
        FROM parcel_planning_segments ps
        JOIN planning_documents pd ON pd.id=ps.document_id
        WHERE ps.parcel_id=p.id ORDER BY pd.plan_key
      )) AS candidatePlanKeysJson,
      (SELECT json_group_array(json_object(
          'planKey',plan_key,'zoneKey',zone_key,'label',label,
          'coverageRatio',coverage_ratio,'intersectionAreaSqm',intersection_area_sqm,
          'landUseCode',land_use_code,'geometryConfidence',geometry_confidence,
          'geometryReviewStatus',geometry_review_status,'rmsResidualM',rms_residual_m,
          'scopePartitionComplete',scope_partition_complete,'landUseComplete',land_use_complete,
          'densityComplete',density_complete,'heightComplete',height_complete,
          'buildingFormComplete',building_form_complete,'otherConstraintsComplete',other_constraints_complete,
          'rules',json(rules_json)
        )) FROM (
          SELECT pd.plan_key, z.zone_key, z.label, ps.coverage_ratio, ps.intersection_area_sqm,
            (SELECT pr.text_value FROM planning_rules pr WHERE pr.zone_id=z.id AND pr.rule_type='land_use' AND pr.applicability='zone_rule' ORDER BY pr.id DESC LIMIT 1) AS land_use_code,
            z.confidence AS geometry_confidence, zr.review_status AS geometry_review_status,
            zr.rms_residual_m, dzr.scope_partition_complete, dzr.land_use_complete,
            dzr.density_complete, dzr.height_complete, dzr.building_form_complete,
            dzr.other_constraints_complete,
            (SELECT json_group_array(json_object(
              'ruleType',pr.rule_type,'numericValue',pr.numeric_value,'textValue',pr.text_value,
              'unit',pr.unit,'legalCitation',pr.legal_citation,'interpretation',pr.interpretation,
              'confidence',pr.confidence,'reviewStatus',pr.review_status,'sourceLocator',pr.source_locator
            )) FROM planning_rules pr WHERE pr.zone_id=z.id AND pr.applicability='zone_rule') AS rules_json
          FROM parcel_planning_segments ps
          JOIN planning_documents pd ON pd.id=ps.document_id
          JOIN planning_zones z ON z.id=ps.zone_id
          LEFT JOIN planning_zone_geometry_reviews zr ON zr.zone_id=z.id
          LEFT JOIN planning_document_zone_reviews dzr ON dzr.document_id=pd.id
          WHERE ps.parcel_id=p.id AND z.geometry_method='georeferenced_scan'
          ORDER BY ps.intersection_area_sqm DESC, z.zone_key
        )) AS bplanInternalZonesJson,
      (SELECT json_group_array(json_object(
          'planKey',pd.plan_key,'ruleType',pr.rule_type,'numericValue',pr.numeric_value,
          'textValue',pr.text_value,'unit',pr.unit,'legalCitation',pr.legal_citation,
          'interpretation',pr.interpretation,'confidence',pr.confidence,
          'reviewStatus',pr.review_status,'sourceLocator',pr.source_locator
        )) FROM planning_rules pr JOIN planning_documents pd ON pd.id=pr.document_id
        WHERE pr.applicability='document_rule' AND EXISTS (
          SELECT 1 FROM parcel_planning_segments ps WHERE ps.parcel_id=p.id AND ps.document_id=pr.document_id
        )) AS bplanDocumentRulesJson,
      (SELECT count(*) FROM parcel_planning_segments ps
        JOIN planning_zones z ON z.id=ps.zone_id AND z.geometry_method='georeferenced_scan'
        WHERE ps.parcel_id=p.id AND ps.coverage_ratio>=0.05
          AND EXISTS (SELECT 1 FROM planning_rules pr WHERE pr.zone_id=z.id AND pr.applicability='zone_rule' AND pr.rule_type='land_use')) AS bplanMaterialInternalLandUseZoneCount,
      (SELECT json_object(
          'planKey',pd.plan_key,'zoneKey',z.zone_key,'label',z.label,
          'landUseCode',(SELECT pr.text_value FROM planning_rules pr WHERE pr.zone_id=z.id AND pr.applicability='zone_rule' AND pr.rule_type='land_use' ORDER BY pr.id DESC LIMIT 1),
          'coverageRatio',ps.coverage_ratio,'confidence',z.confidence,
          'permittedUses',json(coalesce((SELECT pr.text_value FROM planning_rules pr WHERE pr.zone_id=z.id AND pr.applicability='zone_rule' AND pr.rule_type='permitted_uses' ORDER BY pr.id DESC LIMIT 1),'[]')),
          'projectFloorAreaCapSqm',(SELECT pr.numeric_value FROM planning_rules pr WHERE pr.zone_id=z.id AND pr.applicability='zone_rule' AND pr.rule_type='floor_area_max_sqm' ORDER BY pr.id DESC LIMIT 1),
          'absoluteElevationMaxMNhN',(SELECT pr.numeric_value FROM planning_rules pr WHERE pr.zone_id=z.id AND pr.applicability='zone_rule' AND pr.rule_type='absolute_elevation_max_m' ORDER BY pr.id DESC LIMIT 1),
          'sourceLocator',(SELECT pr.source_locator FROM planning_rules pr WHERE pr.zone_id=z.id AND pr.applicability='zone_rule' AND pr.rule_type='land_use' ORDER BY pr.id DESC LIMIT 1),
          'reviewStatus',(SELECT pr.review_status FROM planning_rules pr WHERE pr.zone_id=z.id AND pr.applicability='zone_rule' AND pr.rule_type='land_use' ORDER BY pr.id DESC LIMIT 1)
        )
        FROM parcel_planning_segments ps
        JOIN planning_documents pd ON pd.id=ps.document_id
        JOIN planning_zones z ON z.id=ps.zone_id AND z.geometry_method='georeferenced_scan'
        JOIN planning_document_zone_reviews dzr ON dzr.document_id=pd.id AND dzr.land_use_complete=1 AND dzr.review_status='manually_verified'
        WHERE ps.parcel_id=p.id AND ps.coverage_ratio>=0.95
          AND EXISTS (SELECT 1 FROM planning_rules pr WHERE pr.zone_id=z.id AND pr.applicability='zone_rule' AND pr.rule_type='land_use')
          AND EXISTS (SELECT 1 FROM parcel_planning_segments controlling WHERE controlling.parcel_id=ps.parcel_id AND controlling.document_id=ps.document_id AND controlling.is_controlling=1)
        GROUP BY ps.parcel_id HAVING count(*)=1) AS bplanDominantInternalZoneJson,
      (SELECT json_group_array(text_value) FROM (
        SELECT DISTINCT r.text_value AS text_value
        FROM parcel_planning_segments ps
        JOIN planning_rules r ON r.document_id=ps.document_id
        WHERE ps.parcel_id=p.id AND ps.is_controlling=1
          AND r.applicability='document_summary' AND r.rule_type='land_use'
        ORDER BY r.text_value
      )) AS candidateLandUsesJson,
      bo.text_value AS candidateBaustufe,
      bo.confidence AS candidateBaustufeConfidence,
      bo.source_locator AS candidateBaustufeSourceLocator,
      (SELECT numeric_value FROM planning_codebook_entries c WHERE c.codebook_key='bnp_baustufe' AND c.code=bo.text_value AND c.rule_type='grz') AS candidateGrz,
      (SELECT numeric_value FROM planning_codebook_entries c WHERE c.codebook_key='bnp_baustufe' AND c.code=bo.text_value AND c.rule_type='gfz') AS candidateGfz,
      (SELECT numeric_value FROM planning_codebook_entries c WHERE c.codebook_key='bnp_baustufe' AND c.code=bo.text_value AND c.rule_type='storeys_max') AS candidateStoreysMax,
      (SELECT numeric_value FROM planning_codebook_entries c WHERE c.codebook_key='bnp_baustufe' AND c.code=bo.text_value AND c.rule_type='bmz') AS candidateBmz,
      (SELECT text_value FROM planning_codebook_entries c WHERE c.codebook_key='bnp_baustufe' AND c.code=bo.text_value AND c.rule_type='building_form') AS candidateBnpBuildingForm,
      (SELECT numeric_value FROM planning_codebook_entries c WHERE c.codebook_key='bnp_baustufe' AND c.code=bo.text_value AND c.rule_type='height_max_m') AS candidateBnpHeightMaxM,
      (SELECT source_locator FROM planning_codebook_entries c WHERE c.codebook_key='bnp_baustufe' AND c.code=bo.text_value LIMIT 1) AS candidateBaustufeCodebookSourceLocator
      ,coalesce(lx.line_count,0) AS planningLineCount
      ,coalesce(lx.exact_count,0) AS planningLineExactCount
      ,coalesce(lx.tolerance_count,0) AS planningLineToleranceCount
      ,lx.nearest_distance_m AS planningLineNearestDistanceM
      ,lx.maximum_distance_m AS planningLineMaximumDistanceM
      ,lx.relations_json AS planningLineRelationsJson
      ,lx.types_json AS planningLineTypesJson
      ,lx.approval_kinds_json AS planningLineApprovalKindsJson
      ,lx.official_ids_json AS planningLineOfficialIdsJson
      ,lx.earliest_approval_date AS planningLineEarliestApprovalDate
      ,lx.latest_approval_date AS planningLineLatestApprovalDate
      ,lx.source_updated_at AS planningLineSourceUpdatedAt
      ,CASE WHEN lx.line_count IS NULL THEN NULL WHEN lx.exact_count>0 THEN 'high' ELSE 'medium' END AS planningLineConfidence
      ,lxs.title AS planningLineSourceTitle
      ,lxs.url AS planningLineSourceUrl
      ,lxs.retrieved_at AS planningLineSourceRetrievedAt
      ,fo.text_value AS fnpLandUseCandidate
      ,fo.confidence AS fnpLandUseConfidence
      ,fo.source_locator AS fnpLandUseSourceLocator
      ,json_extract(fo.evidence_json,'$.sourceUpdatedAt') AS fnpSourceUpdatedAt
      ,fs.title AS fnpSourceTitle
      ,fs.url AS fnpSourceUrl
      ,fs.retrieved_at AS fnpSourceRetrievedAt
      ,ro.text_value AS legalRegimeCandidate
      ,ro.confidence AS legalRegimeCandidateConfidence
      ,ro.source_locator AS legalRegimeCandidateSourceLocator
      ,lo.text_value AS bnpLandUseCode
      ,CASE lo.text_value
        WHEN 'village_or_pure_residential' THEN 'Dorfgebiet oder reines Wohngebiet'
        WHEN 'general_residential' THEN 'Allgemeines Wohngebiet'
        WHEN 'mixed' THEN 'Gemischtes Gebiet'
        WHEN 'restricted_work' THEN 'Beschränktes Arbeitsgebiet'
        WHEN 'pure_work' THEN 'Reines Arbeitsgebiet'
        WHEN 'core' THEN 'Kerngebiet'
        WHEN 'land_reserve' THEN 'Baulandreserve'
        WHEN 'special_purpose' THEN 'Besondere Zweckbestimmung'
        WHEN 'non_build_or_forest' THEN 'Nichtbaugebiet oder Waldgebiet'
      END AS bnpLandUseCandidate
      ,lo.confidence AS bnpLandUseConfidence
      ,lo.source_locator AS bnpLandUseSourceLocator
      ,json_extract(lo.evidence_json,'$.sampleAgreement') AS bnpLandUseSampleAgreement
      ,json_extract(lo.evidence_json,'$.classifiedPixelShare') AS bnpLandUseClassifiedPixelShare
      ,CASE WHEN lo.text_value IN ('village_or_pure_residential','non_build_or_forest') THEN 1 ELSE 0 END AS bnpLandUseAmbiguous
      ,ls.title AS bnpLandUseSourceTitle
      ,ls.url AS bnpLandUseSourceUrl
      ,ls.retrieved_at AS bnpLandUseSourceRetrievedAt
      ,CASE
        WHEN lo.text_value='general_residential' AND (SELECT text_value FROM planning_codebook_entries c WHERE c.codebook_key='bnp_baustufe' AND c.code=bo.text_value AND c.rule_type='building_form')='open' THEN 20
        WHEN lo.text_value='general_residential' AND (SELECT text_value FROM planning_codebook_entries c WHERE c.codebook_key='bnp_baustufe' AND c.code=bo.text_value AND c.rule_type='building_form')='closed' THEN 13
        WHEN lo.text_value='mixed' THEN 20
        WHEN lo.text_value='core' THEN 30
        ELSE NULL END AS candidateBnpBuildingDepthM
      ,(SELECT text_value FROM planning_codebook_entries c WHERE c.codebook_key='bnp_land_use_permitted_use' AND c.code=lo.text_value AND c.rule_type='land_use') AS bnpPermittedUsesJson
      ,bs.title AS bnpRuleSourceTitle
      ,bs.url AS bnpRuleSourceUrl
      ,bs.retrieved_at AS bnpRuleSourceRetrievedAt
      ,CASE
        WHEN fo.text_value LIKE 'Wohnbaufläche, W1%' THEN 1.5
        ELSE NULL END AS fnpGfzBandMin
      ,CASE
        WHEN fo.text_value LIKE 'Wohnbaufläche, W2%' THEN 1.5
        WHEN fo.text_value LIKE 'Wohnbaufläche, W3%' THEN 0.8
        WHEN fo.text_value LIKE 'Wohnbaufläche, W4%' THEN 0.4
        ELSE NULL END AS fnpGfzBandMax
      ,json_extract(sc.evidence_json,'$.within50m') AS contextBuildingsWithin50m
      ,json_extract(sc.evidence_json,'$.within100m') AS contextBuildingsWithin100m
      ,json_extract(sc.evidence_json,'$.nearestBuildingDistanceM') AS contextNearestBuildingDistanceM
      ,json_extract(sc.evidence_json,'$.medianObservedStoreys100m') AS contextualStoreysMedian
      ,json_extract(sc.evidence_json,'$.observedStoreySampleSize') AS contextualStoreysSampleSize
      ,json_object(
        'occupancyScreening',json_extract(sc.evidence_json,'$.occupancyScreening'),
        'parcelBuildingCentres',json_extract(sc.evidence_json,'$.parcelBuildingCentres'),
        'parcelBuildingFootprintSqm',json_extract(sc.evidence_json,'$.parcelBuildingFootprintSqm'),
        'occupancyScreeningConfidence',sc.confidence,
        'occupancySourceLocator',sc.source_locator,
        'occupancySourceTitle',ss.title,
        'occupancySourceUrl',ss.url,
        'occupancySourceRetrievedAt',ss.retrieved_at
      ) AS occupancyJson
      ,json_object(
        'capacityOccupancyScreening',json_extract(cap.evidence_json,'$.occupancyScreening'),
        'observedFootprintSqm',json_extract(cap.evidence_json,'$.observedFootprintSqm'),
        'estimatedFloorAreaSqm',json_extract(cap.evidence_json,'$.estimatedFloorAreaSqm'),
        'observedStoreysMax',json_extract(cap.evidence_json,'$.observedStoreysMax'),
        'storeyFootprintCoverage',json_extract(cap.evidence_json,'$.storeyFootprintCoverage'),
        'apparentGrz',json_extract(cap.evidence_json,'$.apparentGrz'),
        'apparentGfz',json_extract(cap.evidence_json,'$.apparentGfz'),
        'capacityConfidence',cap.confidence,
        'capacitySourceLocator',cap.source_locator,
        'capacitySourceTitle',caps.title,
        'capacitySourceUrl',caps.url,
        'capacitySourceRetrievedAt',caps.retrieved_at
      ) AS capacityJson
      ,(SELECT count(*) FROM parcel_planning_segments ps
        JOIN planning_rules pr ON pr.document_id=ps.document_id
        WHERE ps.parcel_id=p.id AND ps.is_controlling=1
          AND pr.extraction_method IN ('embedded_text_mention','ocr')) AS bplanTextMentionCount
      ,(SELECT CASE WHEN count(DISTINCT pr.numeric_value)=1 THEN min(pr.numeric_value) END
        FROM parcel_planning_segments ps JOIN planning_rules pr ON pr.document_id=ps.document_id
        WHERE ps.parcel_id=p.id AND ps.is_controlling=1 AND pr.rule_type='grz'
          AND pr.extraction_method IN ('embedded_text_mention','ocr')) AS bplanCandidateGrz
      ,(SELECT CASE WHEN count(DISTINCT pr.numeric_value)=1 THEN min(pr.numeric_value) END
        FROM parcel_planning_segments ps JOIN planning_rules pr ON pr.document_id=ps.document_id
        WHERE ps.parcel_id=p.id AND ps.is_controlling=1 AND pr.rule_type='gfz'
          AND pr.extraction_method IN ('embedded_text_mention','ocr')) AS bplanCandidateGfz
      ,(SELECT CASE WHEN count(DISTINCT pr.numeric_value)=1 THEN min(pr.numeric_value) END
        FROM parcel_planning_segments ps JOIN planning_rules pr ON pr.document_id=ps.document_id
        WHERE ps.parcel_id=p.id AND ps.is_controlling=1 AND pr.rule_type='storeys_max'
          AND pr.extraction_method IN ('embedded_text_mention','ocr')) AS bplanCandidateStoreysMax
      ,(SELECT CASE WHEN count(DISTINCT pr.text_value)=1 THEN min(pr.text_value) END
        FROM parcel_planning_segments ps JOIN planning_rules pr ON pr.document_id=ps.document_id
        WHERE ps.parcel_id=p.id AND ps.is_controlling=1 AND pr.rule_type='building_form'
          AND pr.extraction_method IN ('embedded_text_mention','ocr')) AS bplanCandidateBuildingForm
      ,(SELECT json_group_array(text_value) FROM (
        SELECT DISTINCT pr.text_value
        FROM parcel_planning_segments ps JOIN planning_rules pr ON pr.document_id=ps.document_id
        WHERE ps.parcel_id=p.id AND ps.is_controlling=1 AND pr.rule_type='land_use'
          AND pr.extraction_method IN ('embedded_text_mention','ocr')
        ORDER BY pr.text_value
      )) AS bplanCandidateLandUsesJson
      ,(SELECT json_object(
          'bplanPlanSheetTotal',count(*),
          'bplanPlanSheetDownloaded',sum(CASE WHEN a.retrieval_status='downloaded' THEN 1 ELSE 0 END),
          'bplanPlanSheetExtracted',sum(CASE WHEN a.extraction_status IN ('machine_extracted','verified') THEN 1 ELSE 0 END),
          'bplanPlanSheetLatestRetrievedAt',max(a.retrieved_at)
        )
        FROM parcel_planning_segments ps
        JOIN planning_document_assets a ON a.document_id=ps.document_id AND a.asset_type='plan_sheet'
        WHERE ps.parcel_id=p.id AND ps.is_controlling=1) AS bplanAssetJson
    FROM requested_parcels rp
    JOIN parcels p ON p.id=rp.id
    LEFT JOIN parcel_jurisdiction_contexts j ON j.parcel_id = p.id
    LEFT JOIN sources js ON js.id = j.source_id
    LEFT JOIN parcel_development_profiles d ON d.parcel_id = p.id
    LEFT JOIN parcel_planning_observations bo ON bo.parcel_id = p.id
      AND bo.observation_type = 'baustufe_candidate'
      AND bo.extraction_method = 'raster_opposing_boundary_candidate_v1'
    LEFT JOIN parcel_planning_observations fo ON fo.parcel_id = p.id
      AND fo.observation_type = 'fnp_land_use_candidate'
      AND fo.extraction_method = 'official_fnp_centroid_overlay_v1'
    LEFT JOIN sources fs ON fs.id=fo.source_id
    LEFT JOIN parcel_planning_observations ro ON ro.parcel_id = p.id
      AND ro.observation_type = 'legal_regime_candidate'
      AND ro.extraction_method = 'combined_official_context_screen_v1'
    LEFT JOIN parcel_planning_observations lo ON lo.parcel_id = p.id
      AND lo.observation_type = 'land_use_candidate'
      AND lo.extraction_method = 'raster_colour_candidate_v1'
      AND j.workflow = 'baunutzungsplan_stack_candidate'
    LEFT JOIN sources ls ON ls.id=lo.source_id
    LEFT JOIN sources bs ON bs.source_key='berlin-bo58-continuing'
    LEFT JOIN line_summary lx ON lx.parcel_id=p.id
    LEFT JOIN sources lxs ON lxs.id=lx.source_id
    LEFT JOIN parcel_planning_observations sc ON sc.parcel_id = p.id
      AND sc.observation_type = 'settlement_context'
      AND sc.extraction_method = 'official_building_centroid_metrics'
    LEFT JOIN sources ss ON ss.id=sc.source_id
    LEFT JOIN parcel_planning_observations cap ON cap.parcel_id=p.id
      AND cap.observation_type='development_capacity_screen'
      AND cap.extraction_method='exact_alkis_building_parcel_overlap_v1'
    LEFT JOIN sources caps ON caps.id=cap.source_id
    ORDER BY rp.capacity_sort_value DESC,rp.completeness_order,p.id
  `;
  const countQuery = `SELECT count(*) AS total FROM parcels p ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`;

  try {
    const [result, totalRow] = await Promise.all([
      env.DB.prepare(query).bind(...values, limit, offset).all(),
      env.DB.prepare(countQuery).bind(...values).first<Record<string, unknown>>(),
    ]);
    const total = Number(totalRow?.total ?? 0);
    const parcels = (result.results ?? []).map((row: Record<string, unknown>) => {
      const occupancy = row.occupancyJson ? JSON.parse(String(row.occupancyJson)) as Record<string, unknown> : {};
      const capacityScreen = row.capacityJson ? JSON.parse(String(row.capacityJson)) as Record<string, unknown> : {};
      const workflow = row.workflowJson ? JSON.parse(String(row.workflowJson)) as Record<string, unknown> : {};
      const profile = row.profileJson ? JSON.parse(String(row.profileJson)) as Record<string, unknown> : {};
      const workflowEvidence = workflow.evidence && typeof workflow.evidence === "object" ? workflow.evidence as Record<string, unknown> : {};
      const bplanAssets = row.bplanAssetJson ? JSON.parse(String(row.bplanAssetJson)) as Record<string, unknown> : {};
      const profileNotes = row.profileNotesJson?.toString().startsWith("{")
        ? JSON.parse(String(row.profileNotesJson)) as Record<string, unknown>
        : null;
      return ({
      ...row,
      ...occupancy,
      ...capacityScreen,
      ...workflow,
      ...profile,
      ...bplanAssets,
      profileNotes,
      resolutionMethod: profileNotes?.resolutionMethod ?? null,
      historicalBoundaryCheck: workflowEvidence.historicalBoundaryCheck ?? null,
      historicalBoundaryCandidate: workflowEvidence.historicalBoundaryCandidate ?? null,
      historicalBoundaryDistanceM: workflowEvidence.historicalBoundaryDistanceM ?? null,
      historicalBoundaryReview: workflowEvidence.historicalBoundaryReview ?? false,
      candidateMaxFootprintSqm: row.candidateGrz == null ? null : Number(row.areaSqm) * Number(row.candidateGrz),
      candidateMaxFloorAreaSqm: row.candidateGfz == null ? null : Number(row.areaSqm) * Number(row.candidateGfz),
      apparentBuildingFootprintShare: occupancy.parcelBuildingFootprintSqm == null || Number(row.areaSqm) <= 0 ? null : Number(occupancy.parcelBuildingFootprintSqm) / Number(row.areaSqm),
      grzUtilization: capacityScreen.apparentGrz == null || profile.legalGrz == null ? null : Number(capacityScreen.apparentGrz) / Number(profile.legalGrz),
      gfzUtilization: capacityScreen.apparentGfz == null || profile.legalGfz == null ? null : Number(capacityScreen.apparentGfz) / Number(profile.legalGfz),
      storeyUtilization: capacityScreen.observedStoreysMax == null || profile.legalStoreysMax == null ? null : Number(capacityScreen.observedStoreysMax) / Number(profile.legalStoreysMax),
      remainingFootprintSqm: capacityScreen.observedFootprintSqm == null || profile.maxPrincipalFootprintSqm == null ? null : Math.max(0, Number(profile.maxPrincipalFootprintSqm) - Number(capacityScreen.observedFootprintSqm)),
      remainingFloorAreaSqm: capacityScreen.estimatedFloorAreaSqm == null || profile.maxLegalFloorAreaSqm == null ? null : Math.max(0, Number(profile.maxLegalFloorAreaSqm) - Number(capacityScreen.estimatedFloorAreaSqm)),
      geometry: JSON.parse(String(row.geometryGeojson)),
      controllingPlanKeys: row.controllingPlanKeysJson
        ? JSON.parse(String(row.controllingPlanKeysJson))
        : [],
      candidatePlanKeys: row.candidatePlanKeysJson
        ? JSON.parse(String(row.candidatePlanKeysJson))
        : [],
      bplanInternalZones: row.bplanInternalZonesJson
        ? JSON.parse(String(row.bplanInternalZonesJson))
        : [],
      bplanDocumentRules: row.bplanDocumentRulesJson
        ? JSON.parse(String(row.bplanDocumentRulesJson))
        : [],
      bplanDominantInternalZone: row.bplanDominantInternalZoneJson
        ? JSON.parse(String(row.bplanDominantInternalZoneJson))
        : null,
      candidateLandUses: row.candidateLandUsesJson
        ? JSON.parse(String(row.candidateLandUsesJson))
        : [],
      bnpPermittedUsesCandidate: row.bnpPermittedUsesJson
        ? JSON.parse(String(row.bnpPermittedUsesJson))
        : [],
      bplanCandidateLandUses: row.bplanCandidateLandUsesJson ? JSON.parse(String(row.bplanCandidateLandUsesJson)) : [],
      planningLineTypes: row.planningLineTypesJson
        ? JSON.parse(String(row.planningLineTypesJson))
        : [],
      planningLineRelations: row.planningLineRelationsJson ? JSON.parse(String(row.planningLineRelationsJson)) : [],
      planningLineApprovalKinds: row.planningLineApprovalKindsJson ? JSON.parse(String(row.planningLineApprovalKindsJson)) : [],
      planningLineOfficialIds: row.planningLineOfficialIdsJson ? JSON.parse(String(row.planningLineOfficialIdsJson)) : [],
      permittedUses: row.permittedUsesJson ? JSON.parse(String(row.permittedUsesJson)) : [],
      otherConstraints: row.otherConstraintsJson ? JSON.parse(String(row.otherConstraintsJson)) : [],
      heritageConstraints: row.heritageConstraintsJson ? JSON.parse(String(row.heritageConstraintsJson)) : [],
      residentialEligibilityMatches: row.residentialEligibilityMatchesJson ? JSON.parse(String(row.residentialEligibilityMatchesJson)) : [],
      unresolvedFields: row.unresolvedFieldsJson
        ? JSON.parse(String(row.unresolvedFieldsJson))
        : [],
      geometryGeojson: undefined,
      controllingPlanKeysJson: undefined,
      candidatePlanKeysJson: undefined,
      otherConstraintsJson: undefined,
      heritageConstraintsJson: undefined,
      bplanInternalZonesJson: undefined,
      bplanDocumentRulesJson: undefined,
      bplanDominantInternalZoneJson: undefined,
      candidateLandUsesJson: undefined,
      bnpPermittedUsesJson: undefined,
      planningLineTypesJson: undefined,
      planningLineRelationsJson: undefined,
      planningLineApprovalKindsJson: undefined,
      planningLineOfficialIdsJson: undefined,
      permittedUsesJson: undefined,
      residentialEligibilityMatchesJson: undefined,
      unresolvedFieldsJson: undefined,
      occupancyJson: undefined,
      capacityJson: undefined,
      workflowJson: undefined,
      profileJson: undefined,
      evidence: undefined,
      bplanAssetJson: undefined,
      bplanCandidateLandUsesJson: undefined,
    });
    });

    return Response.json({
      parcels,
      pagination: { limit, offset, returned: parcels.length, total },
      filters: { bbox, borough, locality, regime, workflow, completeness, occupancy, capacity, heritage, minimumRemainingFloorArea, minimumParcelArea, maximumParcelArea, residentialOnly, sort, search },
      caveat: "Null legal values are unresolved, not zero. This endpoint is screening data, not binding planning advice.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown database error";
    return Response.json({ error: "Parcel query failed", detail: message }, { status: 500 });
  }
}
