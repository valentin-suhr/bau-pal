#!/usr/bin/env node

import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";

function option(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}
function sql(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function main() {
  const input = resolve(option("input", "data/import/bplans-fixed.ndjson"));
  const output = resolve(option("output", "data/import/bplans-fixed.sql"));
  await mkdir(dirname(output), { recursive: true });
  const reader = createInterface({ input: createReadStream(input), crlfDelay: Infinity });
  const writer = createWriteStream(output, { encoding: "utf8" });
  writer.write("BEGIN TRANSACTION;\n");
  let count = 0;
  const relations = [];
  for await (const line of reader) {
    if (!line.trim()) continue;
    const plan = JSON.parse(line);
    const metadata = JSON.stringify({
      officialPlanId: plan.officialPlanId, officialPlanType: plan.officialPlanType,
      procedureType: plan.procedureType, legalStatus: plan.legalStatus,
      scopeDescription: plan.scopeDescription, contents: plan.contents,
      scanUrl: plan.scanUrl, rationaleUrl: plan.rationaleUrl, detailUrl: plan.detailUrl,
      sourceFeatureId: plan.sourceFeatureId, sourceTimestamp: plan.sourceTimestamp,
    });
    writer.write(`INSERT INTO planning_documents (plan_key,title,plan_type,status,borough,effective_from,source_id,notes) SELECT ${sql(plan.planKey)},${sql(plan.title)},${sql(plan.planType)},${sql(plan.status)},${sql(plan.borough)},${sql(plan.effectiveFrom)},id,${sql(metadata)} FROM sources WHERE source_key='berlin-bplan-wfs' ON CONFLICT(plan_key) DO UPDATE SET title=excluded.title,plan_type=excluded.plan_type,status=excluded.status,borough=excluded.borough,effective_from=excluded.effective_from,source_id=excluded.source_id,notes=excluded.notes,updated_at=CURRENT_TIMESTAMP;\n`);
    writer.write(`INSERT INTO planning_zones (document_id,zone_key,label,geometry_geojson,bbox_west,bbox_south,bbox_east,bbox_north,geometry_method,confidence) SELECT id,${sql(plan.zoneKey)},'Official plan scope',${sql(plan.geometryGeojson)},${plan.bbox[0]},${plan.bbox[1]},${plan.bbox[2]},${plan.bbox[3]},'official_vector','official' FROM planning_documents WHERE plan_key=${sql(plan.planKey)} ON CONFLICT(document_id,zone_key) DO UPDATE SET geometry_geojson=excluded.geometry_geojson,bbox_west=excluded.bbox_west,bbox_south=excluded.bbox_south,bbox_east=excluded.bbox_east,bbox_north=excluded.bbox_north;\n`);
    for (const relation of plan.relations ?? []) relations.push({ planKey: plan.planKey, ...relation });
    count += 1;
  }
  for (const relation of relations) {
    const fromKey = relation.direction === "target_to_current" ? relation.targetPlanKey : relation.planKey;
    const toKey = relation.direction === "target_to_current" ? relation.planKey : relation.targetPlanKey;
    writer.write(`INSERT OR IGNORE INTO planning_document_relations (from_document_id,to_document_id,relation,notes) SELECT f.id,t.id,${sql(relation.relation)},${sql(relation.raw)} FROM planning_documents f JOIN planning_documents t ON t.plan_key=${sql(toKey)} WHERE f.plan_key=${sql(fromKey)};\n`);
  }
  writer.write("COMMIT;\n");
  await new Promise((done, reject) => { writer.end(done); writer.on("error", reject); });
  process.stderr.write(`Wrote ${count} B-Plan upserts to ${output}\n`);
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
