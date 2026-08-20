#!/usr/bin/env node

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const inputPath = resolve(process.argv[2] ?? "data/georeferencing/bplans/output.geojson");
const outputPath = resolve(process.argv[3] ?? "data/import/bplan-georeferenced-zones.sql");
const artifact = JSON.parse(await readFile(inputPath, "utf8"));
if (artifact.schemaVersion !== "bplan-georeferenced-zones-v1" || !artifact.qa?.passed) throw new Error("Input is not a QA-passed georeferenced-zone artifact");

const sqlValue = (value) => value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
const sourceSuffix = artifact.sourcePdf.replaceAll("\\", "/");
const sourceLocator = `${artifact.sourcePdf} page ${artifact.sourcePage ?? 1}`;
const geometryReviewStatus = artifact.geometryReviewStatus ?? "machine_checked";
if (!["machine_checked", "manually_verified"].includes(geometryReviewStatus)) throw new Error(`Unsupported geometryReviewStatus: ${geometryReviewStatus}`);
const statements = ["BEGIN TRANSACTION;"];

for (const feature of artifact.features) {
  const { zoneKey, label, confidence = "medium" } = feature.properties ?? {};
  if (!zoneKey || !label || !Array.isArray(feature.bbox) || feature.bbox.length !== 4) throw new Error("Each zone requires zoneKey, label and bbox");
  statements.push(`INSERT INTO planning_zones (document_id,zone_key,label,geometry_geojson,bbox_west,bbox_south,bbox_east,bbox_north,geometry_method,confidence)
SELECT d.id,${sqlValue(zoneKey)},${sqlValue(label)},${sqlValue(JSON.stringify(feature.geometry))},${feature.bbox[0]},${feature.bbox[1]},${feature.bbox[2]},${feature.bbox[3]},'georeferenced_scan',${sqlValue(confidence)}
FROM planning_documents d WHERE d.plan_key=${sqlValue(artifact.planKey)}
ON CONFLICT(document_id,zone_key) DO UPDATE SET label=excluded.label,geometry_geojson=excluded.geometry_geojson,bbox_west=excluded.bbox_west,bbox_south=excluded.bbox_south,bbox_east=excluded.bbox_east,bbox_north=excluded.bbox_north,geometry_method=excluded.geometry_method,confidence=excluded.confidence;`);
  statements.push(`INSERT INTO planning_zone_geometry_reviews (zone_id,source_asset_id,source_page,trace_version,render_json,control_points_json,transform_json,residuals_json,qa_thresholds_json,rms_residual_m,max_residual_m,review_status,reviewed_at,updated_at)
SELECT z.id,(SELECT a.id FROM planning_document_assets a WHERE a.document_id=d.id AND a.asset_type='plan_sheet' AND (replace(a.local_path,'\\','/')=${sqlValue(sourceSuffix)} OR replace(a.local_path,'\\','/') LIKE ${sqlValue(`%/${sourceSuffix}`)}) ORDER BY a.id LIMIT 1),${Number(artifact.sourcePage ?? 1)},${sqlValue(artifact.traceVersion)},${sqlValue(JSON.stringify(artifact.render))},${sqlValue(JSON.stringify(artifact.controlPoints))},${sqlValue(JSON.stringify(artifact.transform))},${sqlValue(JSON.stringify(artifact.qa.residualsMetres))},${sqlValue(JSON.stringify({ maximumRmsResidualMetres: artifact.qa.maximumRmsResidualMetres, maximumResidualMetres: artifact.qa.maximumResidualMetres }))},${artifact.qa.rmsResidualMetres},${artifact.qa.maxResidualMetres},${sqlValue(geometryReviewStatus)},${sqlValue(artifact.generatedAt)},CURRENT_TIMESTAMP
FROM planning_documents d JOIN planning_zones z ON z.document_id=d.id AND z.zone_key=${sqlValue(zoneKey)} WHERE d.plan_key=${sqlValue(artifact.planKey)}
ON CONFLICT(zone_id) DO UPDATE SET source_asset_id=excluded.source_asset_id,source_page=excluded.source_page,trace_version=excluded.trace_version,render_json=excluded.render_json,control_points_json=excluded.control_points_json,transform_json=excluded.transform_json,residuals_json=excluded.residuals_json,qa_thresholds_json=excluded.qa_thresholds_json,rms_residual_m=excluded.rms_residual_m,max_residual_m=excluded.max_residual_m,review_status=excluded.review_status,reviewed_at=excluded.reviewed_at,updated_at=CURRENT_TIMESTAMP;`);
}
statements.push(`DELETE FROM planning_rules WHERE document_id=(SELECT id FROM planning_documents WHERE plan_key=${sqlValue(artifact.planKey)}) AND extraction_method='manual_read' AND source_locator=${sqlValue(sourceLocator)};`);
const rules = [];
for (const feature of artifact.features) {
  if (feature.properties?.landUseCode) rules.push({
    zoneKey: feature.properties.zoneKey,
    ruleType: "land_use",
    textValue: feature.properties.landUseCode,
    interpretation: `The georeferenced plan-sheet zone is labelled ${feature.properties.label}.`,
    confidence: feature.properties.confidence ?? "medium",
  });
  for (const rule of feature.properties?.rules ?? []) rules.push({ ...rule, zoneKey: feature.properties.zoneKey });
}
for (const rule of artifact.rules ?? []) rules.push(rule);
for (const [index, rule] of rules.entries()) {
  if (!rule.ruleType || (rule.numericValue == null && rule.textValue == null)) throw new Error(`Rule ${index} requires ruleType and numericValue or textValue`);
  const zoneExpression = rule.zoneKey
    ? `(SELECT z.id FROM planning_zones z WHERE z.document_id=d.id AND z.zone_key=${sqlValue(rule.zoneKey)})`
    : "NULL";
  statements.push(`INSERT INTO planning_rules (document_id,zone_id,applicability,rule_type,numeric_value,text_value,unit,legal_citation,interpretation,extraction_method,confidence,review_status,source_locator,updated_at)
SELECT d.id,${zoneExpression},${sqlValue(rule.zoneKey ? "zone_rule" : "document_rule")},${sqlValue(rule.ruleType)},${rule.numericValue == null ? "NULL" : Number(rule.numericValue)},${sqlValue(rule.textValue)},${sqlValue(rule.unit)},${sqlValue(rule.legalCitation)},${sqlValue(rule.interpretation)},'manual_read',${sqlValue(rule.confidence ?? "medium")},${sqlValue(rule.reviewStatus ?? geometryReviewStatus)},${sqlValue(sourceLocator)},CURRENT_TIMESTAMP FROM planning_documents d WHERE d.plan_key=${sqlValue(artifact.planKey)};`);
}
const completeness = artifact.completeness ?? {};
const booleanSql = (value) => value === true ? 1 : 0;
statements.push(`INSERT INTO planning_document_zone_reviews (document_id,source_asset_id,trace_version,scope_partition_complete,land_use_complete,density_complete,height_complete,building_form_complete,other_constraints_complete,review_status,notes_json,reviewed_at,updated_at)
SELECT d.id,(SELECT a.id FROM planning_document_assets a WHERE a.document_id=d.id AND a.asset_type='plan_sheet' AND (replace(a.local_path,'\\','/')=${sqlValue(sourceSuffix)} OR replace(a.local_path,'\\','/') LIKE ${sqlValue(`%/${sourceSuffix}`)}) ORDER BY a.id LIMIT 1),${sqlValue(artifact.traceVersion)},${booleanSql(completeness.scopePartitionComplete)},${booleanSql(completeness.landUseComplete)},${booleanSql(completeness.densityComplete)},${booleanSql(completeness.heightComplete)},${booleanSql(completeness.buildingFormComplete)},${booleanSql(completeness.otherConstraintsComplete)},${sqlValue(geometryReviewStatus)},${sqlValue(JSON.stringify(completeness.notes ?? {}))},${sqlValue(artifact.generatedAt)},CURRENT_TIMESTAMP FROM planning_documents d WHERE d.plan_key=${sqlValue(artifact.planKey)}
ON CONFLICT(document_id) DO UPDATE SET source_asset_id=excluded.source_asset_id,trace_version=excluded.trace_version,scope_partition_complete=excluded.scope_partition_complete,land_use_complete=excluded.land_use_complete,density_complete=excluded.density_complete,height_complete=excluded.height_complete,building_form_complete=excluded.building_form_complete,other_constraints_complete=excluded.other_constraints_complete,review_status=excluded.review_status,notes_json=excluded.notes_json,reviewed_at=excluded.reviewed_at,updated_at=CURRENT_TIMESTAMP;`);
statements.push("COMMIT;");
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${statements.join("\n\n")}\n`);
console.log(JSON.stringify({ input: inputPath, output: outputPath, planKey: artifact.planKey, zoneCount: artifact.features.length }, null, 2));
