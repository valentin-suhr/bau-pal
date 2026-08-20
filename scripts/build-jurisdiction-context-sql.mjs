#!/usr/bin/env node

import { createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";

function option(name, fallback) { const p = `--${name}=`; return process.argv.find((v) => v.startsWith(p))?.slice(p.length) ?? fallback; }
function sql(value) { return value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`; }
async function segmentParcels(path) {
  const ids = new Set(); const reader = createInterface({ input: createReadStream(resolve(path)), crlfDelay: Infinity });
  for await (const line of reader) if (line.trim()) ids.add(JSON.parse(line).parcelId);
  return ids;
}
async function main() {
  const covered = await segmentParcels(option("segments", "data/import/parcel-planning-segments.ndjson"));
  const input = createInterface({ input: createReadStream(resolve(option("parcels", "data/import/alkis-parcels-sector.ndjson"))), crlfDelay: Infinity });
  const output = resolve(option("output", "data/import/parcel-jurisdiction-contexts.sql"));
  await mkdir(dirname(output), { recursive: true }); const writer = createWriteStream(output, { encoding: "utf8" });
  writer.write("BEGIN TRANSACTION;\n"); let count = 0; const workflows = {};
  for await (const line of input) {
    if (!line.trim()) continue; const row = JSON.parse(line); const context = row.jurisdictionContext ?? {};
    const hasBplan = covered.has(row.id);
    const boundaryCorroborated = context.historicalBoundaryCheck === "corroborated" && !context.historicalBoundaryReview;
    const boundaryReview = context.historicalBoundaryCheck === "disagrees" || context.historicalBoundaryReview;
    const westCandidate = context.historicalSector === "former_west_proxy" && boundaryCorroborated;
    const historicalSector = boundaryReview ? "historical_boundary_review" : context.historicalSector ?? "unknown";
    const workflow = hasBplan ? "bplan_scope_candidate" : westCandidate ? "baunutzungsplan_stack_candidate" : "section_34_35_unresolved";
    const reason = hasBplan ? "Parcel intersects at least one imported in-force B-Plan scope; precedence and internal zoning remain to be resolved."
      : workflow === "baunutzungsplan_stack_candidate" ? "No imported in-force B-Plan scope; the official Ortsteil routing proxy is independently corroborated by the official 1989 wall line and is more than 150 m from that non-parcel-accurate line."
      : boundaryReview ? "No imported in-force B-Plan scope; the locality proxy and official 1989 wall line disagree or the parcel lies within 150 m of the non-parcel-accurate line. BNP applicability is withheld pending historical-boundary review."
      : "No imported in-force B-Plan scope; §34 versus §35 requires settlement-context assessment.";
    const sourceKey = hasBplan ? "berlin-bplan-wfs" : "berlin-wall-1989-wfs";
    const confidence = hasBplan ? "high" : boundaryReview ? "low" : context.confidence ?? "unknown";
    const evidence = JSON.stringify({ locality: row.locality, borough: row.borough, historicalSectorProxy: context.historicalSector ?? "unknown", historicalBoundaryCheck: context.historicalBoundaryCheck ?? "unresolved", historicalBoundaryCandidate: context.historicalBoundaryCandidate ?? null, historicalBoundaryDistanceM: context.historicalBoundaryDistanceM ?? null, historicalBoundaryReview: boundaryReview, bplanScopeIntersection: hasBplan });
    const assignmentMethod = hasBplan ? "official_bplan_scope_intersection" : boundaryReview ? "historical_boundary_conflict_review" : "official_wall_and_ortsteil_corroboration";
    const sourceLocator = hasBplan ? "WFS bplan scope overlay" : `${context.historicalBoundarySourceLocator}; ALKIS Ortsteil centroid proxy`;
    writer.write(`INSERT INTO parcel_jurisdiction_contexts (parcel_id,locality,historical_sector,workflow,reason,assignment_method,confidence,source_id,source_locator,evidence_json) SELECT ${sql(row.id)},${sql(row.locality)},${sql(historicalSector)},${sql(workflow)},${sql(reason)},${sql(assignmentMethod)},${sql(confidence)},id,${sql(sourceLocator)},${sql(evidence)} FROM sources WHERE source_key=${sql(sourceKey)} ON CONFLICT(parcel_id) DO UPDATE SET locality=excluded.locality,historical_sector=excluded.historical_sector,workflow=excluded.workflow,reason=excluded.reason,assignment_method=excluded.assignment_method,confidence=excluded.confidence,source_id=excluded.source_id,source_locator=excluded.source_locator,evidence_json=excluded.evidence_json,updated_at=CURRENT_TIMESTAMP;\n`);
    workflows[workflow] = (workflows[workflow] ?? 0) + 1; count += 1;
  }
  writer.write("COMMIT;\n"); await new Promise((done, reject) => { writer.end(done); writer.on("error", reject); });
  process.stderr.write(`Wrote ${count} jurisdiction contexts: ${JSON.stringify(workflows)}\n`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
