import test from "node:test";
import assert from "node:assert/strict";

import { normalizeFluchtlinie } from "../scripts/import-fluchtlinien.mjs";

test("normalises an official Fluchtlinie with legal and update metadata", () => {
  const result = normalizeFluchtlinie({
    id: "fluchtlinien.02002",
    geometry: { type: "MultiLineString", coordinates: [[[13.37, 52.5], [13.38, 52.51]]] },
    properties: {
      uid: "02002", bezirk: "Friedrichshain-Kreuzberg",
      a_text: "A.C.O.", a_datum: "1842-09-16", a_datum2: null,
      typ: "Straßen- und Baufluchtlinie", datum: "2022-11-29",
    },
  }, "2026-08-01T00:00:00Z");
  assert.equal(result.officialId, "02002");
  assert.equal(result.lineType, "street_and_building_line");
  assert.equal(result.approvalKind, "A.C.O.");
  assert.equal(result.approvalDate, "1842-09-16");
  assert.equal(result.sourceUpdatedAt, "2022-11-29");
  assert.deepEqual(result.bbox, [13.37, 52.5, 13.38, 52.51]);
});
