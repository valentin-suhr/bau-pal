import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFeature } from "../scripts/import-alkis.mjs";

test("normalizes an ALKIS parcel without inventing planning data", () => {
  const result = normalizeFeature({
    type: "Feature",
    id: "flurstuecke.example",
    geometry: {
      type: "MultiPolygon",
      coordinates: [[[[13.33, 52.49], [13.34, 52.49], [13.34, 52.50], [13.33, 52.50], [13.33, 52.49]]]],
    },
    properties: {
      uuid: "DEBE-example",
      afl: 1242,
      fsko: "110030006001040004",
      zae: "104",
      nen: "4",
      gmk: "0030",
      namgmk: "Wilmersdorf",
      fln: "6",
      namgem: "Charlottenburg-Wilmersdorf",
      beg: "2024-04-22",
    },
  }, "2026-08-01T00:00:00Z");

  assert.equal(result.id, "110030006001040004");
  assert.equal(result.areaSqm, 1242);
  assert.equal(result.numerator, "104");
  assert.equal(result.denominator, "4");
  assert.equal(result.borough, "Charlottenburg-Wilmersdorf");
  assert.ok(result.centroidLng > 13.33 && result.centroidLng < 13.34);
  assert.ok(result.centroidLat > 52.49 && result.centroidLat < 52.50);
  assert.equal("legalGrz" in result, false);
});

test("keeps the centroid of a narrow cadastral sliver inside its bounds", () => {
  const result = normalizeFeature({
    type: "Feature",
    id: "flurstuecke.sliver",
    bbox: [13.33121522, 52.49285196, 13.33123366, 52.49302791],
    geometry: {
      type: "MultiPolygon",
      coordinates: [[[[13.33121522, 52.49285196], [13.33121955, 52.49285308], [13.33123366, 52.49302791], [13.33121522, 52.49285196]]]],
    },
    properties: {
      uuid: "DEBE-sliver",
      afl: 3,
      fsko: "110030006001230135",
      zae: "123",
      nen: "135",
      gmk: "0030",
      namgmk: "Wilmersdorf",
      fln: "6",
      namgem: "Charlottenburg-Wilmersdorf",
    },
  });

  assert.ok(result.centroidLng >= result.bboxWest && result.centroidLng <= result.bboxEast);
  assert.ok(result.centroidLat >= result.bboxSouth && result.centroidLat <= result.bboxNorth);
});
