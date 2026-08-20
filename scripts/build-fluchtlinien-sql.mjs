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
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}
async function rows(path) {
  const reader = createInterface({ input: createReadStream(resolve(path)), crlfDelay: Infinity });
  return reader;
}

async function main() {
  const linesPath = option("lines", "data/import/fluchtlinien.ndjson");
  const relationsPath = option("relations", "data/import/parcel-fluchtlinien.ndjson");
  const output = resolve(option("output", "data/import/fluchtlinien.sql"));
  await mkdir(dirname(output), { recursive: true });
  const writer = createWriteStream(output, { encoding: "utf8" });
  writer.write("BEGIN TRANSACTION;\n");
  let lines = 0, relations = 0;
  for await (const line of await rows(linesPath)) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    writer.write(`INSERT INTO planning_line_features (official_id,line_type,official_line_type,approval_kind,approval_date,approval_date_end,borough,geometry_geojson,bbox_west,bbox_south,bbox_east,bbox_north,source_id,source_updated_at) SELECT ${sql(row.officialId)},${sql(row.lineType)},${sql(row.officialLineType)},${sql(row.approvalKind)},${sql(row.approvalDate)},${sql(row.approvalDateEnd)},${sql(row.borough)},${sql(row.geometryGeojson)},${row.bbox[0]},${row.bbox[1]},${row.bbox[2]},${row.bbox[3]},id,${sql(row.sourceUpdatedAt)} FROM sources WHERE source_key='berlin-fluchtlinien-wfs' ON CONFLICT(official_id) DO UPDATE SET line_type=excluded.line_type,official_line_type=excluded.official_line_type,approval_kind=excluded.approval_kind,approval_date=excluded.approval_date,approval_date_end=excluded.approval_date_end,borough=excluded.borough,geometry_geojson=excluded.geometry_geojson,bbox_west=excluded.bbox_west,bbox_south=excluded.bbox_south,bbox_east=excluded.bbox_east,bbox_north=excluded.bbox_north,source_id=excluded.source_id,source_updated_at=excluded.source_updated_at,imported_at=CURRENT_TIMESTAMP;\n`);
    lines += 1;
  }
  for await (const line of await rows(relationsPath)) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    writer.write(`INSERT INTO parcel_planning_lines (parcel_id,line_id,relation,distance_m,assignment_method,confidence) SELECT ${sql(row.parcelId)},id,${sql(row.relation)},${sql(row.distanceM)},${sql(row.assignmentMethod)},${sql(row.confidence)} FROM planning_line_features WHERE official_id=${sql(row.officialLineId)} ON CONFLICT(parcel_id,line_id) DO UPDATE SET relation=excluded.relation,distance_m=excluded.distance_m,assignment_method=excluded.assignment_method,confidence=excluded.confidence;\n`);
    relations += 1;
  }
  writer.write("COMMIT;\n");
  await new Promise((done, reject) => { writer.end(done); writer.on("error", reject); });
  process.stderr.write(`Wrote ${lines} line and ${relations} parcel/line upserts to ${output}\n`);
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
