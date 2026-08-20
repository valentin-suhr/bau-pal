import test from "node:test";
import assert from "node:assert/strict";
import { buildIndex, classify, segments } from "../scripts/refine-historical-sector.mjs";

test("classifies points by odd/even crossings of official boundary linework", () => {
  const feature = {
    id: "boundary.1",
    __layer: "a_grenzmauer",
    geometry: { type: "LineString", coordinates: [[13.1, 52.4], [13.2, 52.4], [13.2, 52.5], [13.1, 52.5], [13.1, 52.4]] },
  };
  const index = buildIndex(segments([feature]));
  assert.equal(classify([13.15, 52.45], index).west, true);
  assert.equal(classify([13.25, 52.45], index).west, false);
});

test("reports proximity for boundary-review routing", () => {
  const feature = {
    id: "boundary.1",
    __layer: "a_grenzmauer",
    geometry: { type: "LineString", coordinates: [[13.1, 52.4], [13.2, 52.4]] },
  };
  const result = classify([13.15, 52.4001], buildIndex(segments([feature])));
  assert.ok(result.nearestBoundaryM > 0 && result.nearestBoundaryM < 20);
});
