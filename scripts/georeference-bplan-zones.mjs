#!/usr/bin/env node

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fitAffineTransform, geometryBbox, transformGeometry } from "./lib/affine-georeference.mjs";

const inputPath = resolve(process.argv[2] ?? "data/georeferencing/bplans/input.json");
const outputPath = resolve(process.argv[3] ?? "data/georeferencing/bplans/output.geojson");
const input = JSON.parse(await readFile(inputPath, "utf8"));

if (input.schemaVersion !== "bplan-pixel-trace-v1") throw new Error(`Unsupported schemaVersion: ${input.schemaVersion}`);
if (!input.planKey || !input.sourcePdf || !input.render) throw new Error("planKey, sourcePdf and render metadata are required");
if (!Array.isArray(input.zones?.features) || !input.zones.features.length) throw new Error("At least one traced zone feature is required");

const fitted = fitAffineTransform(input.controlPoints);
const maximumRmsResidualMetres = input.qa?.maximumRmsResidualMetres ?? 2;
const maximumResidualMetres = input.qa?.maximumResidualMetres ?? 5;
if (fitted.qa.rmsResidualMetres > maximumRmsResidualMetres || fitted.qa.maxResidualMetres > maximumResidualMetres) {
  throw new Error(`Georeferencing residual exceeds threshold: RMS ${fitted.qa.rmsResidualMetres.toFixed(3)} m, max ${fitted.qa.maxResidualMetres.toFixed(3)} m`);
}

const features = input.zones.features.map((feature, index) => {
  if (!feature.properties?.zoneKey || !feature.properties?.label) throw new Error(`Zone ${index} requires zoneKey and label`);
  const geometry = transformGeometry(feature.geometry, fitted.transform);
  return {
    type: "Feature",
    geometry,
    bbox: geometryBbox(geometry),
    properties: {
      ...feature.properties,
      planKey: input.planKey,
      geometryMethod: "georeferenced_scan_affine_v1",
      confidence: feature.properties.confidence ?? "medium",
      sourcePdf: input.sourcePdf,
      sourcePage: input.sourcePage ?? 1,
    },
  };
});

const output = {
  type: "FeatureCollection",
  schemaVersion: "bplan-georeferenced-zones-v1",
  generatedAt: new Date().toISOString(),
  planKey: input.planKey,
  sourcePdf: input.sourcePdf,
  sourcePage: input.sourcePage ?? 1,
  render: input.render,
  controlPoints: input.controlPoints,
  traceVersion: input.traceVersion ?? "manual_trace_v1",
  geometryReviewStatus: input.geometryReviewStatus ?? "machine_checked",
  completeness: {
    scopePartitionComplete: input.completeness?.scopePartitionComplete ?? false,
    landUseComplete: input.completeness?.landUseComplete ?? false,
    densityComplete: input.completeness?.densityComplete ?? false,
    heightComplete: input.completeness?.heightComplete ?? false,
    buildingFormComplete: input.completeness?.buildingFormComplete ?? false,
    otherConstraintsComplete: input.completeness?.otherConstraintsComplete ?? false,
    notes: input.completeness?.notes ?? {},
  },
  rules: input.rules ?? [],
  transform: fitted.coefficients,
  qa: {
    ...fitted.qa,
    maximumRmsResidualMetres,
    maximumResidualMetres,
    passed: true,
  },
  features,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ output: outputPath, planKey: input.planKey, zoneCount: features.length, qa: output.qa }, null, 2));
