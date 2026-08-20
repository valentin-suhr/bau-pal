#!/usr/bin/env node

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import proj4 from "proj4";
import { SOLDNER_BERLIN_PROJ4 } from "./lib/soldner-grid-controls.mjs";
import { fitAffineTransform } from "./lib/affine-georeference.mjs";

const configPath = resolve(process.argv[2] ?? "data/georeferencing/bplans/anchor.json");
const outputPath = resolve(process.argv[3] ?? "data/georeferencing/bplans/anchor-controls.json");
const config = JSON.parse(await readFile(configPath, "utf8"));
if (!Array.isArray(config.anchorPixel) || !Array.isArray(config.anchorSoldner) || !Array.isArray(config.eastings) || !Array.isArray(config.northings)) throw new Error("anchorPixel, anchorSoldner, eastings and northings are required");
const pixelsPerMetre = config.pixelsPerMetre ?? config.dpi / 25.4 * 1000 / config.planScaleDenominator;
if (!Number.isFinite(pixelsPerMetre) || pixelsPerMetre <= 0) throw new Error("pixelsPerMetre or dpi and planScaleDenominator must define a positive scale");
const [anchorX, anchorY] = config.anchorPixel;
const [anchorEasting, anchorNorthing] = config.anchorSoldner;
const crs = config.crs ?? SOLDNER_BERLIN_PROJ4;
const controlPoints = [];
for (const easting of config.eastings) for (const northing of config.northings) {
  const pixel = [anchorX + (easting - anchorEasting) * pixelsPerMetre, anchorY - (northing - anchorNorthing) * pixelsPerMetre];
  controlPoints.push({ label: `${easting}_${northing}`, pixel, world: proj4(crs, "EPSG:4326", [easting, northing]) });
}
const fitted = fitAffineTransform(controlPoints);
const estimatedAnchorPixelUncertainty = config.estimatedAnchorPixelUncertainty ?? 3;
const estimatedRegistrationUncertaintyMetres = estimatedAnchorPixelUncertainty / pixelsPerMetre;
const maximumEstimatedRegistrationUncertaintyMetres = config.maximumEstimatedRegistrationUncertaintyMetres ?? 1;
const output = {
  schemaVersion: "soldner-anchor-controls-v1",
  image: { width: config.renderWidth, height: config.renderHeight, cropOrigin: config.cropOrigin ?? [0, 0] },
  crs,
  construction: {
    method: config.pixelsPerMetre == null ? "printed_coordinate_anchor_nominal_plan_scale_v1" : "printed_grid_anchor_observed_spacing_v1",
    anchorLabel: config.anchorLabel,
    anchorPixel: config.anchorPixel,
    anchorSoldner: config.anchorSoldner,
    dpi: config.dpi,
    planScaleDenominator: config.planScaleDenominator,
    pixelsPerMetre,
    scaleBasis: config.pixelsPerMetre == null ? "nominal plan scale" : "observed spacing between printed 100 m grid labels on both axes",
    estimatedAnchorPixelUncertainty,
  },
  controlPoints,
  qa: {
    ...fitted.qa,
    estimatedRegistrationUncertaintyMetres,
    maximumEstimatedRegistrationUncertaintyMetres,
    validationMethod: "registered_cadastral_overlay_visual_review_required",
    passed: estimatedRegistrationUncertaintyMetres <= maximumEstimatedRegistrationUncertaintyMetres,
  },
};
if (!output.qa.passed) throw new Error(`Estimated anchor uncertainty ${estimatedRegistrationUncertaintyMetres.toFixed(3)}m exceeds threshold`);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ output: outputPath, controls: controlPoints.length, qa: output.qa }, null, 2));
