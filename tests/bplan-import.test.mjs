import test from "node:test";
import assert from "node:assert/strict";

import { normalizeBplanFeature } from "../scripts/import-bplans.mjs";

test("normalises official B-Plan metadata without inventing internal rules", () => {
  const result = normalizeBplanFeature({
    id: "bplan.ix35",
    properties: {
      planid: "0409035",
      planname: "IX-35",
      planartname: "Qualifizierter B-Plan",
      bezirk: "04 - Charlottenburg-Wilmersdorf",
      bp_rechtsstand: "festgesetzt",
      ersetztteil: "0400001 (IX-A)",
      ersetztdurchteil: "0409155 (IX-155)",
      scan_www: "https://example.test/ix-35.pdf",
    },
    geometry: { type: "Polygon", coordinates: [[[13.3, 52.4], [13.4, 52.4], [13.4, 52.5], [13.3, 52.4]]] },
  }, "fixed", "2026-08-01T00:00:00Z");

  assert.equal(result.planKey, "IX-35");
  assert.equal(result.planType, "qualified_bplan");
  assert.equal(result.status, "in_force");
  assert.equal(result.borough, "Charlottenburg-Wilmersdorf");
  assert.equal(result.zoneKey, "IX-35:scope");
  assert.equal(result.grz, undefined);
  assert.deepEqual(result.relations.map(({ relation, direction, targetPlanKey }) => ({ relation, direction, targetPlanKey })), [
    { relation: "partially_supersedes", direction: "current_to_target", targetPlanKey: "IX-A" },
    { relation: "partially_supersedes", direction: "target_to_current", targetPlanKey: "IX-155" },
  ]);
});
