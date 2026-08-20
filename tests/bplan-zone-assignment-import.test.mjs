import assert from "node:assert/strict";
import test from "node:test";
import { assignZoneToParcel, planRegime } from "../scripts/assign-bplan-zones.mjs";

test("maps each B-Plan type to its legal regime", () => {
  assert.equal(planRegime("qualified_bplan"), "section_30_1");
  assert.equal(planRegime("project_bplan"), "section_30_2");
  assert.equal(planRegime("simple_bplan"), "section_30_3");
  assert.equal(planRegime("unknown"), "unresolved");
});

test("intersects a georeferenced zone with a parcel and retains provenance", () => {
  const parcel = {
    id: "parcel-1",
    areaSqm: 7550,
    bboxWest: 13.4,
    bboxSouth: 52.5,
    bboxEast: 13.401,
    bboxNorth: 52.501,
    geometryGeojson: JSON.stringify({
      type: "Polygon",
      coordinates: [[[13.4, 52.5], [13.401, 52.5], [13.401, 52.501], [13.4, 52.501], [13.4, 52.5]]],
    }),
  };
  const zone = {
    bbox: [13.4005, 52.5, 13.4015, 52.501],
    properties: { planKey: "TEST", zoneKey: "TEST:WA", confidence: "medium" },
    geometry: {
      type: "Polygon",
      coordinates: [[[13.4005, 52.5], [13.4015, 52.5], [13.4015, 52.501], [13.4005, 52.501], [13.4005, 52.5]]],
    },
  };
  const result = assignZoneToParcel(parcel, zone, "qualified_bplan");
  assert.equal(result.planKey, "TEST");
  assert.equal(result.zoneKey, "TEST:WA");
  assert.equal(result.legalRegime, "section_30_1");
  assert.equal(result.assignmentMethod, "georeferenced_zone_intersection");
  assert.ok(result.coverageRatio > 0.45 && result.coverageRatio < 0.55);
});

test("does not create a segment for disjoint bounding boxes", () => {
  const parcel = {
    id: "parcel-1", areaSqm: 1,
    bboxWest: 13.4, bboxSouth: 52.5, bboxEast: 13.401, bboxNorth: 52.501,
    geometryGeojson: JSON.stringify({ type: "Polygon", coordinates: [[[13.4,52.5],[13.401,52.5],[13.401,52.501],[13.4,52.501],[13.4,52.5]]] }),
  };
  const zone = {
    bbox: [14, 53, 14.1, 53.1], properties: { planKey: "TEST", zoneKey: "TEST:WA" },
    geometry: { type: "Polygon", coordinates: [[[14,53],[14.1,53],[14.1,53.1],[14,53.1],[14,53]]] },
  };
  assert.equal(assignZoneToParcel(parcel, zone, "qualified_bplan"), null);
});
