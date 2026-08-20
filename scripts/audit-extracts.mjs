#!/usr/bin/env node

import { createReadStream, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";

function option(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}
async function eachRow(path, visit) {
  const reader = createInterface({ input: createReadStream(resolve(path)), crlfDelay: Infinity });
  for await (const line of reader) if (line.trim()) visit(JSON.parse(line));
}

async function main() {
  const parcelsPath = option("parcels", existsSync("data/import/alkis-parcels-locality.ndjson") ? "data/import/alkis-parcels-locality.ndjson" : "data/import/alkis-parcels.ndjson");
  const segmentsPath = option("segments", "data/import/parcel-planning-segments.ndjson");
  const bnpCandidatesPath = option("bnp-candidates", "data/import/parcel-bnp-candidates.ndjson");
  const planningLinesPath = option("planning-lines", "data/import/parcel-fluchtlinien.ndjson");
  const settlementContextPath = option("settlement-context", "data/import/parcel-building-context.ndjson");
  const output = resolve(option("output", "data/qa/citywide-import-audit.json"));
  const parcelIds = new Set();
  const uuids = new Set();
  const boroughs = {};
  const parcels = {
    rows: 0, duplicateIds: 0, duplicateUuids: 0, malformedIds: 0,
    missingBorough: 0, missingLocality: 0, nonPositiveArea: 0, invalidCentroid: 0, invalidGeometry: 0,
    historicalSectorProxy: {},
  };
  await eachRow(parcelsPath, (row) => {
    parcels.rows += 1;
    if (parcelIds.has(row.id)) parcels.duplicateIds += 1; else parcelIds.add(row.id);
    if (uuids.has(row.alkisUuid)) parcels.duplicateUuids += 1; else uuids.add(row.alkisUuid);
    if (!/^[A-Za-z0-9_]{18}$/.test(row.id)) parcels.malformedIds += 1;
    if (!row.borough) parcels.missingBorough += 1;
    else boroughs[row.borough] = (boroughs[row.borough] ?? 0) + 1;
    if (!row.locality) parcels.missingLocality += 1;
    const sector = row.jurisdictionContext?.historicalSector ?? "not_assigned";
    parcels.historicalSectorProxy[sector] = (parcels.historicalSectorProxy[sector] ?? 0) + 1;
    if (!(row.areaSqm > 0)) parcels.nonPositiveArea += 1;
    if (!(row.centroidLng >= row.bboxWest && row.centroidLng <= row.bboxEast
      && row.centroidLat >= row.bboxSouth && row.centroidLat <= row.bboxNorth)) parcels.invalidCentroid += 1;
    try {
      const geometry = JSON.parse(row.geometryGeojson);
      if (!["Polygon", "MultiPolygon"].includes(geometry.type)) parcels.invalidGeometry += 1;
    } catch { parcels.invalidGeometry += 1; }
  });

  const covered = new Set();
  const plans = new Set();
  const segmentCounts = new Map();
  const regimes = {};
  const segments = { rows: 0, invalidCoverageRatio: 0, nonPositiveArea: 0 };
  await eachRow(segmentsPath, (row) => {
    segments.rows += 1;
    covered.add(row.parcelId);
    plans.add(row.planKey);
    segmentCounts.set(row.parcelId, (segmentCounts.get(row.parcelId) ?? 0) + 1);
    regimes[row.legalRegime] = (regimes[row.legalRegime] ?? 0) + 1;
    if (!(row.coverageRatio > 0 && row.coverageRatio <= 1)) segments.invalidCoverageRatio += 1;
    if (!(row.intersectionAreaSqm > 0)) segments.nonPositiveArea += 1;
  });
  const overlapHistogram = {};
  for (const value of segmentCounts.values()) overlapHistogram[value] = (overlapHistogram[value] ?? 0) + 1;

  const bnpCandidates = { rows: 0, classified: 0, withheld: 0, byClass: {}, byConfidence: {} };
  if (existsSync(resolve(bnpCandidatesPath))) {
    await eachRow(bnpCandidatesPath, (row) => {
      bnpCandidates.rows += 1;
      if (row.candidateLandUseCode) {
        bnpCandidates.classified += 1;
        bnpCandidates.byClass[row.candidateLandUseCode] = (bnpCandidates.byClass[row.candidateLandUseCode] ?? 0) + 1;
      } else bnpCandidates.withheld += 1;
      bnpCandidates.byConfidence[row.confidence] = (bnpCandidates.byConfidence[row.confidence] ?? 0) + 1;
    });
  }
  const planningLines = { rows: 0, parcels: 0, lines: 0, byType: {}, byRelation: {}, byConfidence: {} };
  if (existsSync(resolve(planningLinesPath))) {
    const lineParcels = new Set();
    const lineIds = new Set();
    await eachRow(planningLinesPath, (row) => {
      planningLines.rows += 1;
      lineParcels.add(row.parcelId);
      lineIds.add(row.officialLineId);
      planningLines.byType[row.lineType] = (planningLines.byType[row.lineType] ?? 0) + 1;
      planningLines.byRelation[row.relation] = (planningLines.byRelation[row.relation] ?? 0) + 1;
      planningLines.byConfidence[row.confidence] = (planningLines.byConfidence[row.confidence] ?? 0) + 1;
    });
    planningLines.parcels = lineParcels.size;
    planningLines.lines = lineIds.size;
  }
  const settlementContext = { rows: 0, zeroBuildingsWithin100m: 0, noBuildingCentreOnParcel: 0, withStoreySample: 0 };
  if (existsSync(resolve(settlementContextPath))) {
    await eachRow(settlementContextPath, (row) => {
      settlementContext.rows += 1;
      if (row.evidence?.within100m === 0) settlementContext.zeroBuildingsWithin100m += 1;
      if (row.evidence?.parcelBuildingCentres === 0) settlementContext.noBuildingCentreOnParcel += 1;
      if (row.evidence?.observedStoreySampleSize > 0) settlementContext.withStoreySample += 1;
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    grain: "one ALKIS Flurstück per parcel row; zero or more B-Plan scope segments per parcel",
    sources: { parcelsPath, segmentsPath },
    parcels: { ...parcels, distinctIds: parcelIds.size, distinctUuids: uuids.size, boroughs },
    planningSegments: {
      ...segments, distinctPlans: plans.size, coveredParcels: covered.size,
      uncoveredParcels: parcels.rows - covered.size,
      coveredParcelRate: covered.size / parcels.rows,
      regimes, overlapHistogram,
    },
    baunutzungsplanCandidates: bnpCandidates,
    fluchtlinienRelations: planningLines,
    settlementContext,
    findings: [
      { severity: parcels.duplicateIds || parcels.duplicateUuids ? "critical" : "pass", check: "primary-key uniqueness", affectedRows: parcels.duplicateIds + parcels.duplicateUuids },
      { severity: parcels.invalidGeometry || parcels.invalidCentroid ? "critical" : "pass", check: "geometry validity", affectedRows: parcels.invalidGeometry + parcels.invalidCentroid },
      { severity: parcels.nonPositiveArea ? "medium" : "pass", check: "positive official area", affectedRows: parcels.nonPositiveArea, action: "Keep official value but exclude from capacity calculations pending source review." },
      { severity: parcels.missingLocality ? "low" : "pass", check: "Ortsteil centroid assignment", affectedRows: parcels.missingLocality, action: "Review boundary/water slivers manually; historical East/West values remain workflow proxies, not legal findings." },
      { severity: segments.invalidCoverageRatio || segments.nonPositiveArea ? "high" : "pass", check: "spatial-intersection validity", affectedRows: segments.invalidCoverageRatio + segments.nonPositiveArea },
      { severity: "medium", check: "Baunutzungsplan raster classification", affectedRows: bnpCandidates.classified, action: "Treat as candidates only; resolve ambiguous classes, Baustufe boundaries, BO 1958 and Fluchtlinien before filling legal profile values." },
      { severity: "medium", check: "§34/§35 settlement context", affectedRows: settlementContext.rows, action: "Metrics describe current ALKIS building continuity only; never convert them automatically into a binding §34 or §35 classification." },
    ],
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
