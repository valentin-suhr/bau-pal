#!/usr/bin/env node

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { extractSoldnerGridControls } from "./lib/soldner-grid-controls.mjs";
import { fitAffineTransform } from "./lib/affine-georeference.mjs";

const [imageArgument, configArgument, outputArgument] = process.argv.slice(2);
if (!imageArgument || !configArgument) throw new Error("Usage: extract-soldner-grid-controls.mjs <crop.png> <config.json> [output.json]");
const imagePath = resolve(imageArgument);
const configPath = resolve(configArgument);
const outputPath = resolve(outputArgument ?? `${imageArgument}.controls.json`);
const config = JSON.parse(await readFile(configPath, "utf8"));
const result = extractSoldnerGridControls(await readFile(imagePath), config);
const affine = fitAffineTransform(result.controlPoints);
result.qa = { ...affine.qa, passed: affine.qa.rmsResidualMetres <= (config.maximumRmsResidualMetres ?? 0.25) && affine.qa.maxResidualMetres <= (config.maximumResidualMetres ?? 0.5) };
if (!result.qa.passed) throw new Error(`Affine QA failed: RMS ${result.qa.rmsResidualMetres.toFixed(3)}m, max ${result.qa.maxResidualMetres.toFixed(3)}m`);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ output: outputPath, controls: result.controlPoints.length, qa: result.qa }, null, 2));
