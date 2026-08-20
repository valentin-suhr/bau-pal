import test from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { extractSoldnerGridControls } from "../scripts/lib/soldner-grid-controls.mjs";
import { fitAffineTransform } from "../scripts/lib/affine-georeference.mjs";

test("extracts a regular, slightly skewed Soldner grid from a raster", () => {
  const png = new PNG({ width: 360, height: 320, colorType: 6 });
  png.data.fill(255);
  const paint = (x, y) => {
    if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
    const offset = (y * png.width + x) * 4;
    png.data[offset] = 30; png.data[offset + 1] = 30; png.data[offset + 2] = 30; png.data[offset + 3] = 255;
  };
  for (let y = 0; y < png.height; y += 1) for (const intercept of [60, 180, 300]) paint(Math.round(0.002 * y + intercept), y);
  for (let x = 0; x < png.width; x += 1) for (const intercept of [45, 155, 265]) paint(x, Math.round(-0.001 * x + intercept));
  const result = extractSoldnerGridControls(PNG.sync.write(png), {
    eastings: [25200, 25300, 25400], northings: [22400, 22300, 22200], cropOrigin: [1000, 2000], minimumCoverage: 0.7,
  });
  assert.equal(result.controlPoints.length, 9);
  assert.ok(result.detection.verticalSpacingIrregularity < 0.01);
  assert.ok(result.detection.horizontalSpacingIrregularity < 0.01);
  assert.equal(result.controlPoints[0].label, "25200_22400");
  assert.ok(Math.abs(result.controlPoints[0].pixel[0] - 1060) < 1);
  assert.ok(Math.abs(result.controlPoints[0].pixel[1] - 2045) < 1);
  assert.ok(fitAffineTransform(result.controlPoints).qa.rmsResidualMetres < 0.15);
});

test("rejects a raster without enough full-length grid lines", () => {
  const png = new PNG({ width: 100, height: 100, colorType: 6 });
  png.data.fill(255);
  assert.throws(() => extractSoldnerGridControls(PNG.sync.write(png), {
    eastings: [1, 2], northings: [2, 1], minimumCoverage: 0.7,
  }), /grid-line candidates/);
});

test("uses expected map-scale spacing to reject a stronger false regular grid", () => {
  const png = new PNG({ width: 500, height: 400, colorType: 6 });
  png.data.fill(255);
  const paint = (x, y, radius = 0) => {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const px = x + dx; if (px < 0 || px >= png.width || y < 0 || y >= png.height) continue;
      const offset = (y * png.width + px) * 4;
      png.data[offset] = 20; png.data[offset + 1] = 20; png.data[offset + 2] = 20; png.data[offset + 3] = 255;
    }
  };
  for (let y = 0; y < png.height; y += 1) {
    for (const x of [80, 180, 280, 380]) paint(x, y);
    for (const x of [35, 175, 315, 455]) paint(x, y, 1);
  }
  for (let x = 0; x < png.width; x += 1) {
    for (const y of [45, 145, 245, 345]) paint(x, y);
  }
  const result = extractSoldnerGridControls(PNG.sync.write(png), {
    eastings: [25000, 25100, 25200, 25300], northings: [22000, 21900, 21800, 21700],
    minimumCoverage: 0.8, expectedSpacingPx: 100, spacingTolerance: 0.02,
  });
  assert.ok(Math.abs(result.detection.verticalSpacingPx - 100) < 0.01);
  assert.ok(Math.abs(result.detection.horizontalSpacingPx - 100) < 0.01);
});
