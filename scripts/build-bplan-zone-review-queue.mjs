#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { localD1Path } from "./local-d1-path.mjs";

const database = await localD1Path();
const output = resolve(process.argv[2] ?? "data/qa/bplan-zone-review-queue.json");
const dispositionPath = resolve("data/qa/bplan-manual-review-dispositions.json");
const dispositionArtifact = JSON.parse(await readFile(dispositionPath, "utf8"));
const dispositions = new Map();
const supportedDispositionRoutes = new Set(["resolved_reviewed", "partially_georeferenced", "requires_internal_zone_georeferencing", "requires_legal_effect_review"]);
for (const disposition of dispositionArtifact.dispositions ?? []) {
  if (dispositions.has(disposition.planKey)) throw new Error(`Duplicate manual review disposition: ${disposition.planKey}`);
  if (!supportedDispositionRoutes.has(disposition.route)) throw new Error(`Unsupported manual review route for ${disposition.planKey}`);
  dispositions.set(disposition.planKey, disposition);
}
const sql = `
WITH controlling AS (
  SELECT document_id,count(DISTINCT parcel_id) AS controlling_parcels,
    sum(CASE WHEN coverage_ratio>=0.99 THEN 1 ELSE 0 END) AS near_total_parcels,
    round(sum(intersection_area_sqm),1) AS controlling_area_sqm
  FROM parcel_planning_segments WHERE is_controlling=1 GROUP BY document_id
), assets AS (
  SELECT document_id,
    sum(CASE WHEN asset_type='plan_sheet' THEN 1 ELSE 0 END) AS sheet_total,
    sum(CASE WHEN asset_type='plan_sheet' AND retrieval_status='downloaded' THEN 1 ELSE 0 END) AS sheet_downloaded,
    sum(CASE WHEN asset_type='plan_sheet' AND extraction_status IN ('machine_extracted','verified') THEN 1 ELSE 0 END) AS sheet_extracted
  FROM planning_document_assets GROUP BY document_id
), rules AS (
  SELECT document_id,
    count(*) FILTER (WHERE extraction_method IN ('embedded_text_mention','ocr')) AS text_mentions,
    count(DISTINCT CASE WHEN extraction_method='official_structured' AND rule_type='land_use' AND text_value NOT IN ('VERKEHRSFLAECHE','GRUENFLAECHE') THEN text_value END) AS substantive_official_uses,
    count(DISTINCT CASE WHEN extraction_method IN ('embedded_text_mention','ocr') AND rule_type='grz' THEN numeric_value END) AS grz_values,
    count(DISTINCT CASE WHEN extraction_method IN ('embedded_text_mention','ocr') AND rule_type='gfz' THEN numeric_value END) AS gfz_values,
    count(DISTINCT CASE WHEN extraction_method IN ('embedded_text_mention','ocr') AND rule_type='storeys_max' THEN numeric_value END) AS storey_values,
    count(DISTINCT CASE WHEN extraction_method IN ('embedded_text_mention','ocr') AND rule_type='building_form' THEN text_value END) AS form_values
  FROM planning_rules GROUP BY document_id
), zone_review AS (
  SELECT document_id,review_status,scope_partition_complete,land_use_complete,
    density_complete,height_complete,building_form_complete,other_constraints_complete
  FROM planning_document_zone_reviews
)
SELECT d.plan_key,d.title,c.controlling_parcels,c.near_total_parcels,c.controlling_area_sqm,
  coalesce(a.sheet_total,0) AS sheet_total,coalesce(a.sheet_downloaded,0) AS sheet_downloaded,
  coalesce(a.sheet_extracted,0) AS sheet_extracted,coalesce(r.text_mentions,0) AS text_mentions,
  coalesce(r.substantive_official_uses,0) AS substantive_official_uses,
  coalesce(r.grz_values,0) AS grz_values,coalesce(r.gfz_values,0) AS gfz_values,
  coalesce(r.storey_values,0) AS storey_values,coalesce(r.form_values,0) AS form_values,
  CASE WHEN EXISTS (SELECT 1 FROM planning_zones z WHERE z.document_id=d.id AND z.geometry_method IN ('manual_plan_sheet_single_zone_parcel_match_v1','manual_plan_sheet_composite_parcel_match_v1','manual_plan_sheet_qualified_single_zone_parcel_match_v1','manual_plan_sheet_use_storey_parcel_match_v1','manual_plan_sheet_special_land_parcel_match_v1')) THEN 'resolved_reviewed'
    WHEN zr.review_status='manually_verified' AND zr.scope_partition_complete=1 AND zr.land_use_complete=1 AND zr.density_complete=1 AND zr.height_complete=1 AND zr.building_form_complete=1 AND zr.other_constraints_complete=1 THEN 'resolved_reviewed'
    WHEN zr.document_id IS NOT NULL THEN 'partially_georeferenced'
    WHEN EXISTS (SELECT 1 FROM planning_zones z JOIN planning_rules lr ON lr.zone_id=z.id WHERE z.document_id=d.id AND z.geometry_method='judgment_current_cadastral_match_v1' AND lr.rule_type='legal_effect' AND lr.review_status='manually_verified') THEN 'partially_georeferenced'
    WHEN coalesce(a.sheet_downloaded,0)=0 THEN 'acquire_plan_sheet'
    WHEN c.controlling_parcels=1 AND c.near_total_parcels=1
      AND coalesce(r.substantive_official_uses,0)<=1
      AND coalesce(r.grz_values,0)<=1 AND coalesce(r.gfz_values,0)<=1
      AND coalesce(r.storey_values,0)<=1 AND coalesce(r.form_values,0)<=1 THEN 'priority_visual_single_zone_review'
    ELSE 'requires_internal_zone_georeferencing' END AS review_route
FROM planning_documents d JOIN controlling c ON c.document_id=d.id
LEFT JOIN assets a ON a.document_id=d.id LEFT JOIN rules r ON r.document_id=d.id
LEFT JOIN zone_review zr ON zr.document_id=d.id
ORDER BY CASE review_route WHEN 'priority_visual_single_zone_review' THEN 0 WHEN 'resolved_reviewed' THEN 1 WHEN 'acquire_plan_sheet' THEN 2 ELSE 3 END,
  CASE WHEN review_route='priority_visual_single_zone_review' THEN c.controlling_parcels END ASC,
  CASE WHEN review_route='priority_visual_single_zone_review' THEN coalesce(r.text_mentions,0) END DESC,
  c.controlling_parcels DESC,d.plan_key`;

const rows = JSON.parse(execFileSync("sqlite3", ["-json", database, sql], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }) || "[]").map((row) => {
  const disposition = dispositions.get(row.plan_key);
  if (disposition) {
    if (disposition.route === "resolved_reviewed" && row.review_route !== "resolved_reviewed") {
      throw new Error(`Manual disposition marks ${row.plan_key} resolved without a resolved zone geometry in D1`);
    }
    if (disposition.route === "partially_georeferenced" && row.review_route !== "partially_georeferenced") {
      throw new Error(`Manual disposition marks ${row.plan_key} partially georeferenced without reviewed partial geometry or legal-effect evidence in D1`);
    }
    return {
      ...row,
      review_route: disposition.route,
      manual_review: {
        reviewed_at: dispositionArtifact.reviewedAt,
        source_pdf: disposition.sourcePdf,
        reason: disposition.reason,
      },
    };
  }
  if (row.review_route === "requires_internal_zone_georeferencing" && row.controlling_parcels > 1) {
    return {
      ...row,
      routing_reason: "Multiple current ALKIS parcels require parcel-zone allocation; document-level uses or project-wide maxima cannot be duplicated across parcel rows.",
    };
  }
  return row;
});

const knownPlanKeys = new Set(rows.map((row) => row.plan_key));
for (const planKey of dispositions.keys()) {
  if (!knownPlanKeys.has(planKey)) throw new Error(`Manual review disposition references unknown controlling plan: ${planKey}`);
}
const routeRank = new Map([
  ["priority_visual_single_zone_review", 0],
  ["requires_legal_effect_review", 1],
  ["partially_georeferenced", 2],
  ["resolved_reviewed", 3],
  ["acquire_plan_sheet", 4],
  ["requires_internal_zone_georeferencing", 5],
]);
rows.sort((a, b) => (routeRank.get(a.review_route) ?? 99) - (routeRank.get(b.review_route) ?? 99)
  || (a.review_route === "priority_visual_single_zone_review" ? a.controlling_parcels - b.controlling_parcels : b.controlling_parcels - a.controlling_parcels)
  || a.plan_key.localeCompare(b.plan_key));
const summary = rows.reduce((acc, row) => {
  acc[row.review_route] = (acc[row.review_route] ?? 0) + 1;
  return acc;
}, {});
const artifact = {
  generatedAt: new Date().toISOString(),
  database,
  manualDispositionSource: dispositionPath,
  manualDispositionCount: dispositions.size,
  planCount: rows.length,
  summary,
  rows,
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({ output, planCount: rows.length, summary }, null, 2));
