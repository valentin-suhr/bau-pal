import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fitAffineTransform, geometryBbox, transformGeometry } from "../scripts/lib/affine-georeference.mjs";

test("fits an overdetermined affine pixel-to-world transform with metre-scale QA", () => {
  const expected = ([x, y]) => [13.4 + x * 0.00001 + y * 0.000002, 52.5 - x * 0.000001 - y * 0.000009];
  const pixels = [[0, 0], [1000, 0], [0, 1000], [1000, 1000], [430, 710]];
  const fitted = fitAffineTransform(pixels.map((pixel) => ({ pixel, world: expected(pixel) })));
  const actual = fitted.transform([250, 800]);
  assert.ok(Math.abs(actual[0] - expected([250, 800])[0]) < 1e-10);
  assert.ok(Math.abs(actual[1] - expected([250, 800])[1]) < 1e-10);
  assert.ok(fitted.qa.rmsResidualMetres < 0.001);
});

test("rejects collinear control points", () => {
  assert.throws(() => fitAffineTransform([
    { pixel: [0, 0], world: [13.4, 52.5] },
    { pixel: [10, 10], world: [13.41, 52.51] },
    { pixel: [20, 20], world: [13.42, 52.52] },
  ]), /stable affine transform/);
});

test("transforms traced polygon coordinates and reports a WGS84 bbox", () => {
  const geometry = transformGeometry({
    type: "Polygon",
    coordinates: [[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]],
  }, ([x, y]) => [13 + x / 1000, 52 + y / 1000]);
  assert.deepEqual(geometryBbox(geometry), [13, 52, 13.1, 52.1]);
  assert.deepEqual(geometry.coordinates[0][2], [13.1, 52.1]);
});

test("production artifact retains typed overlay rules and explicit incomplete families", async () => {
  const artifact = JSON.parse(await readFile(new URL("../data/georeferencing/bplans/I-203.geojson", import.meta.url), "utf8"));
  assert.equal(artifact.completeness.scopePartitionComplete, true);
  assert.equal(artifact.completeness.otherConstraintsComplete, false);
  assert.ok(artifact.features.some((feature) => feature.properties.zoneKey === "I-203:building-envelope"));
  assert.ok(artifact.features.some((feature) => feature.properties.zoneKey === "I-203:TG1"));
  assert.ok(artifact.rules.some((rule) => rule.ruleType === "floor_area_max_sqm" && rule.numericValue === 11500));
  assert.ok(artifact.rules.some((rule) => rule.ruleType === "absolute_elevation_max_m" && rule.numericValue === 52));
});

test("zone SQL preserves document completeness and document-versus-zone rule scope", async () => {
  const sql = await readFile(new URL("../data/import/I-203-georeferenced-zones.sql", import.meta.url), "utf8");
  assert.match(sql, /planning_document_zone_reviews/);
  assert.match(sql, /'floor_area_max_sqm'/);
  assert.match(sql, /'absolute_elevation_max_m'/);
  assert.match(sql, /'document_rule'/);
  assert.match(sql, /'zone_rule'/);
});

test("I-14a cadastral overlay resolves only reviewed WA use fields", async () => {
  const controls = JSON.parse(await readFile(new URL("../data/georeferencing/bplans/I-14a.soldner-controls.json", import.meta.url), "utf8"));
  const sql = await readFile(new URL("../data/seed/resolve-i14a-cadastral-use-profiles.sql", import.meta.url), "utf8");
  assert.equal(controls.controlPoints.length, 16);
  assert.ok(controls.qa.rmsResidualMetres < 0.1);
  assert.ok(controls.qa.maxResidualMetres < 0.15);
  assert.match(sql, /11000161900295____' THEN 'general_residential_wa2'/);
  assert.match(sql, /ELSE 'general_residential_wa1'/);
  assert.match(sql, /grz_base_value_and_exception_interpretation/);
  assert.doesNotMatch(sql, /SET legal_grz=/);
  assert.doesNotMatch(sql, /SET legal_gfz=/);
  assert.doesNotMatch(sql, /SET legal_storeys_max=/);
});

test("I-57 generated overlay excludes unresolved edge parcels and dimensional values", async () => {
  const controls = JSON.parse(await readFile(new URL("../data/georeferencing/bplans/I-57.soldner-controls.json", import.meta.url), "utf8"));
  const spec = JSON.parse(await readFile(new URL("../data/georeferencing/bplans/I-57.cadastral-profile.json", import.meta.url), "utf8"));
  const sql = await readFile(new URL("../data/import/I-57-cadastral-use-overlay.sql", import.meta.url), "utf8");
  assert.equal(controls.controlPoints.length, 16);
  assert.ok(controls.qa.rmsResidualMetres < 1);
  assert.ok(controls.qa.maxResidualMetres < 1.5);
  assert.equal(spec.assignments.length, 5);
  assert.ok(!spec.assignments.some((assignment) => assignment.parcelId.endsWith("00240____") || assignment.parcelId.endsWith("00242____")));
  assert.match(sql, /manual_i57_cadastral_overlay_v1/);
  assert.doesNotMatch(sql, /SET legal_grz=/);
  assert.doesNotMatch(sql, /SET legal_gfz=/);
  assert.doesNotMatch(sql, /SET legal_storeys_max=/);
});

test("1-47 anchor overlay records uncertainty and withholds the boundary sliver", async () => {
  const controls = JSON.parse(await readFile(new URL("../data/georeferencing/bplans/1-47.soldner-controls.json", import.meta.url), "utf8"));
  const spec = JSON.parse(await readFile(new URL("../data/georeferencing/bplans/1-47.cadastral-profile.json", import.meta.url), "utf8"));
  const sql = await readFile(new URL("../data/import/1-47-cadastral-use-overlay.sql", import.meta.url), "utf8");
  assert.equal(controls.schemaVersion, "soldner-anchor-controls-v1");
  assert.equal(controls.controlPoints.length, 15);
  assert.ok(controls.qa.estimatedRegistrationUncertaintyMetres > controls.qa.rmsResidualMetres);
  assert.ok(controls.qa.estimatedRegistrationUncertaintyMetres < controls.qa.maximumEstimatedRegistrationUncertaintyMetres);
  assert.equal(spec.assignments.length, 4);
  assert.ok(!spec.assignments.some((assignment) => assignment.parcelId === "11000306300466____"));
  assert.match(sql, /estimatedRegistrationUncertaintyMetres/);
  assert.doesNotMatch(sql, /SET legal_grz=/);
  assert.doesNotMatch(sql, /SET legal_storeys_max=/);
});
