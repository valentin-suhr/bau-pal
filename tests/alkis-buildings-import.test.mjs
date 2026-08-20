import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBuilding } from "../scripts/import-alkis-buildings.mjs";

test("normalises official ALKIS building context", () => {
  const row = normalizeBuilding({ geometry: { type: "Polygon", coordinates: [[[13,52],[13.1,52],[13.1,52.1],[13,52]]] }, properties: { uuid: "b1", gfk: 2050, bezgfk: "Geschäftsgebäude", aog: 4, hoh: "12.5", shape_area: 251.92 } }, "2026-08-01");
  assert.equal(row.functionCode, "2050"); assert.equal(row.aboveGroundStoreys, 4); assert.equal(row.heightM, 12.5); assert.equal(row.footprintSqm, 251.92);
});
