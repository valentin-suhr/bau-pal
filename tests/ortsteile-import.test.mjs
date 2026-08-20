import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOrtsteil } from "../scripts/import-ortsteile.mjs";
import { historicalSector } from "../scripts/assign-localities.mjs";

test("normalises official Ortsteil attributes", () => {
  const row = normalizeOrtsteil({ geometry: { type: "Polygon", coordinates: [[[13, 52], [14, 52], [14, 53], [13, 52]]] }, properties: { uuid: "u", sch: "11", nam: "Mitte", gdf: 10 } }, "2026-01-01");
  assert.equal(row.name, "Mitte"); assert.deepEqual(row.bbox, [13, 52, 14, 53]);
});
test("historical sector remains explicitly a proxy", () => {
  assert.equal(historicalSector("Friedrichshain-Kreuzberg", "Kreuzberg"), "former_west_proxy");
  assert.equal(historicalSector("Friedrichshain-Kreuzberg", "Friedrichshain"), "former_east_proxy");
  assert.equal(historicalSector("Mitte", "Moabit"), "former_west_proxy");
  assert.equal(historicalSector("Mitte", "Mitte"), "former_east_proxy");
});
