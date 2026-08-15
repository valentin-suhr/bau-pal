import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";
const completeCore = "d.legal_land_use_code IS NOT NULL AND d.permitted_uses_json!='[]' AND d.legal_grz IS NOT NULL AND d.legal_gfz IS NOT NULL AND d.legal_storeys_max IS NOT NULL AND d.building_form IS NOT NULL";
const anyCore = "d.legal_land_use_code IS NOT NULL OR d.permitted_uses_json!='[]' OR d.legal_grz IS NOT NULL OR d.legal_gfz IS NOT NULL OR d.legal_storeys_max IS NOT NULL OR d.building_form IS NOT NULL";

function boundedInteger(value: string | null, fallback: number, maximum: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}
function nonnegativeNumber(value: string | null) { const parsed = Number(value); return value != null && value.trim() !== "" && Number.isFinite(parsed) && parsed >= 0 ? parsed : null; }

export async function GET(request: Request) {
  if (!env.DB) return Response.json({ error: "Parcel database is not configured" }, { status: 503 });

  const url = new URL(request.url);
  const borough = url.searchParams.get("borough")?.trim() || "Steglitz-Zehlendorf";
  const locality = url.searchParams.get("locality")?.trim() || "Lichterfelde";
  const showAll = url.searchParams.get("all") === "true";
  const perStatus = boundedInteger(url.searchParams.get("perStatus"), 500, 1000);
  const requestedMode = url.searchParams.get("mode");
  const mode = requestedMode === "capacity" || requestedMode === "heritage" ? requestedMode : "processing";
  const workflow = url.searchParams.get("workflow")?.trim() || null;
  const completeness = url.searchParams.get("completeness")?.trim() || null;
  const occupancy = url.searchParams.get("occupancy")?.trim() || null;
  const capacity = url.searchParams.get("capacity")?.trim() || null;
  const heritage = url.searchParams.get("heritage")?.trim() || null;
  const minimumRemainingFloorArea = nonnegativeNumber(url.searchParams.get("minimumRemainingFloorArea"));
  const minimumParcelArea = nonnegativeNumber(url.searchParams.get("minimumParcelArea"));
  const maximumParcelArea = nonnegativeNumber(url.searchParams.get("maximumParcelArea"));
  const residentialOnly = url.searchParams.get("residentialOnly") === "true";
  const where = ["p.borough=?", "p.locality=?"];
  const values: Array<string | number> = [borough, locality];
  if (workflow) { where.push("EXISTS (SELECT 1 FROM parcel_jurisdiction_contexts j_filter WHERE j_filter.parcel_id=p.id AND j_filter.workflow=?)"); values.push(workflow); }
  if (completeness === "complete") where.push(`(${completeCore})`);
  else if (completeness === "partial") where.push(`NOT (${completeCore}) AND (${anyCore})`);
  else if (completeness === "unresolved") where.push(`NOT (${anyCore})`);
  if (["building_footprint_detected", "no_building_footprint_detected"].includes(occupancy ?? "")) { where.push("json_extract(cap.evidence_json,'$.occupancyScreening')=?"); values.push(occupancy as string); }
  if (capacity === "vacant") where.push("json_extract(cap.evidence_json,'$.occupancyScreening')='no_building_footprint_detected'");
  else if (["under_50", "between_50_80", "over_80"].includes(capacity ?? "")) {
    where.push("json_extract(cap.evidence_json,'$.occupancyScreening')!='no_building_footprint_detected'");
    where.push("json_extract(cap.evidence_json,'$.apparentGfz') IS NOT NULL AND d.legal_gfz IS NOT NULL");
    where.push(capacity === "under_50" ? "json_extract(cap.evidence_json,'$.apparentGfz')/d.legal_gfz<0.5" : capacity === "between_50_80" ? "json_extract(cap.evidence_json,'$.apparentGfz')/d.legal_gfz>=0.5 AND json_extract(cap.evidence_json,'$.apparentGfz')/d.legal_gfz<0.8" : "json_extract(cap.evidence_json,'$.apparentGfz')/d.legal_gfz>=0.8");
  } else if (capacity === "unassessed") where.push("cap.id IS NULL OR (json_extract(cap.evidence_json,'$.occupancyScreening')!='no_building_footprint_detected' AND (json_extract(cap.evidence_json,'$.apparentGfz') IS NULL OR d.legal_gfz IS NULL))");
  if (minimumRemainingFloorArea != null) { where.push("json_extract(cap.evidence_json,'$.apparentGfz') IS NOT NULL AND d.max_legal_floor_area_sqm IS NOT NULL AND d.max_legal_floor_area_sqm-json_extract(cap.evidence_json,'$.estimatedFloorAreaSqm')>=?"); values.push(minimumRemainingFloorArea); }
  if (residentialOnly) where.push("EXISTS (SELECT 1 FROM json_each(d.permitted_uses_json) use_filter WHERE lower(use_filter.value) LIKE '%residential%' OR lower(use_filter.value) LIKE '%dwelling%')");
  if (minimumParcelArea != null) { where.push("p.area_sqm>=?"); values.push(minimumParcelArea); }
  if (maximumParcelArea != null) { where.push("p.area_sqm<=?"); values.push(maximumParcelArea); }
  if (heritage === "direct") where.push("EXISTS (SELECT 1 FROM parcel_heritage_constraints ph WHERE ph.parcel_id=p.id AND ph.relation='direct_overlap')");
  else if (heritage === "nearby") where.push("EXISTS (SELECT 1 FROM parcel_heritage_constraints ph WHERE ph.parcel_id=p.id AND ph.relation='nearby_50m')");
  else if (heritage === "none") where.push("EXISTS (SELECT 1 FROM sources WHERE source_key='berlin-denkmale-wfs') AND NOT EXISTS (SELECT 1 FROM parcel_heritage_constraints ph WHERE ph.parcel_id=p.id)");
  const statusCase = mode === "heritage" ? `CASE
          WHEN EXISTS (SELECT 1 FROM parcel_heritage_constraints ph WHERE ph.parcel_id=p.id AND ph.relation='direct_overlap') THEN 'heritage_direct'
          WHEN EXISTS (SELECT 1 FROM parcel_heritage_constraints ph WHERE ph.parcel_id=p.id AND ph.relation='nearby_50m') THEN 'heritage_nearby'
          WHEN EXISTS (SELECT 1 FROM sources WHERE source_key='berlin-denkmale-wfs') THEN 'heritage_none'
          ELSE 'heritage_unassessed' END` : mode === "capacity" ? `CASE
          WHEN json_extract(cap.evidence_json,'$.occupancyScreening')='no_building_footprint_detected' THEN 'vacant'
          WHEN d.legal_gfz IS NULL OR json_extract(cap.evidence_json,'$.apparentGfz') IS NULL THEN 'unassessed'
          WHEN json_extract(cap.evidence_json,'$.apparentGfz')/d.legal_gfz<0.5 THEN 'high_potential'
          WHEN json_extract(cap.evidence_json,'$.apparentGfz')/d.legal_gfz<0.8 THEN 'moderate_potential'
          ELSE 'near_full' END` : `CASE
          WHEN d.legal_land_use_code IS NOT NULL AND d.permitted_uses_json!='[]'
            AND d.legal_grz IS NOT NULL AND d.legal_gfz IS NOT NULL
            AND d.legal_storeys_max IS NOT NULL AND d.building_form IS NOT NULL THEN 'processed'
          WHEN d.legal_land_use_code IS NOT NULL OR d.legal_grz IS NOT NULL OR d.legal_gfz IS NOT NULL
            OR EXISTS (SELECT 1 FROM parcel_planning_segments ps
              JOIN planning_document_assets a ON a.document_id=ps.document_id
              WHERE ps.parcel_id=p.id AND ps.is_controlling=1 AND a.asset_type='plan_sheet'
                AND a.extraction_status IN ('machine_extracted','verified')) THEN 'in_progress'
          ELSE 'unprocessed' END`;
  const query = `
    WITH scoped AS (
      SELECT p.id,p.area_sqm,p.centroid_lng,p.centroid_lat,p.geometry_geojson,
        d.legal_land_use_label,d.legal_grz,d.legal_gfz,d.legal_storeys_max,d.building_form,
        d.max_legal_floor_area_sqm,d.controlling_plan_keys_json,
        json_extract(cap.evidence_json,'$.occupancyScreening') AS occupancy_screening,
        json_extract(cap.evidence_json,'$.observedFootprintSqm') AS observed_footprint_sqm,
        json_extract(cap.evidence_json,'$.estimatedFloorAreaSqm') AS estimated_floor_area_sqm,
        json_extract(cap.evidence_json,'$.apparentGfz') AS apparent_gfz,
        EXISTS (SELECT 1 FROM parcel_heritage_constraints ph_hatch WHERE ph_hatch.parcel_id=p.id AND ph_hatch.relation='direct_overlap') AS heritage_direct,
        ${statusCase} AS processing_status
      FROM parcels p JOIN parcel_development_profiles d ON d.parcel_id=p.id
      LEFT JOIN parcel_planning_observations cap ON cap.parcel_id=p.id
        AND cap.observation_type='development_capacity_screen'
        AND cap.extraction_method='exact_alkis_building_parcel_overlap_v1'
      WHERE ${where.map((condition) => `(${condition})`).join(" AND ")}
    ), ranked AS (
      SELECT *,row_number() OVER (PARTITION BY processing_status ORDER BY id) AS status_rank,
        count(*) OVER (PARTITION BY processing_status) AS status_total FROM scoped
    )
    SELECT id,area_sqm AS areaSqm,centroid_lng AS centroidLng,centroid_lat AS centroidLat,
      geometry_geojson AS geometryGeojson,processing_status AS processingStatus,
      status_total AS statusTotal,legal_land_use_label AS legalLandUseLabel,
      legal_grz AS legalGrz,legal_gfz AS legalGfz,legal_storeys_max AS legalStoreysMax,
      building_form AS buildingForm,heritage_direct AS heritageDirect,
      max_legal_floor_area_sqm AS maxLegalFloorAreaSqm,
      controlling_plan_keys_json AS controllingPlanKeysJson,
      occupancy_screening AS occupancyScreening,observed_footprint_sqm AS observedFootprintSqm,
      estimated_floor_area_sqm AS estimatedFloorAreaSqm,apparent_gfz AS apparentGfz
    FROM ranked ${showAll ? "" : "WHERE status_rank<=?"} ORDER BY processing_status,id`;
  try {
    const result = await env.DB.prepare(query).bind(...values, ...(showAll ? [] : [perStatus])).all();
    const counts: Record<string, number> = {};
    const parcels = ((result.results ?? []) as Array<Record<string, unknown>>).map((row) => {
      const status = String(row.processingStatus);
      counts[status] = Number(row.statusTotal ?? 0);
      return {
        ...row,
        geometry: JSON.parse(String(row.geometryGeojson)),
        controllingPlanKeys: JSON.parse(String(row.controllingPlanKeysJson ?? "[]")),
        remainingFloorAreaSqm: row.maxLegalFloorAreaSqm == null || row.estimatedFloorAreaSqm == null
          ? null
          : Math.max(0, Number(row.maxLegalFloorAreaSqm) - Number(row.estimatedFloorAreaSqm)),
        geometryGeojson: undefined,
        controllingPlanKeysJson: undefined,
        statusTotal: undefined,
      };
    });
    return Response.json({ parcels, counts, samplingApplied: !showAll, sampledPerStatus: showAll ? null : perStatus, returned: parcels.length, borough, locality, mode, filters: { workflow, completeness, occupancy, capacity, heritage, minimumRemainingFloorArea, minimumParcelArea, maximumParcelArea, residentialOnly },
      caveat: mode === "heritage" ? "Heritage flags are a spatial cross-reference with the official Berlin Denkmale WFS; nearby status is a review flag, not a legal determination." : mode === "capacity" ? "Capacity compares estimated ALKIS building mass with resolved legal GFZ; it is indicative, not a building-permit determination." : "Processed means the core dashboard fields are populated; it is not a building-permit determination." });
  } catch (error) {
    return Response.json({ error: "Parcel map query failed", detail: error instanceof Error ? error.message : "Unknown database error" }, { status: 500 });
  }
}
