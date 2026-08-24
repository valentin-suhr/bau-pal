import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { localD1Path } from "../scripts/local-d1-path.mjs";

let database = null;
try {
  database = await localD1Path();
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const databaseTest = (name, fn) => test(name, { skip: !database && "local D1 database is not part of the repository" }, fn);
const scalar = (sql) => Number(execFileSync("sqlite3", [database, sql], { encoding: "utf8" }).trim() || 0);

databaseTest("QGIS land-use screens cover every Lichterfelde parcel exactly once", () => {
  const parcels = scalar("SELECT count(*) FROM parcels WHERE borough='Steglitz-Zehlendorf' AND locality='Lichterfelde'");
  const screens = scalar("SELECT count(*) FROM parcel_planning_observations o JOIN parcels p ON p.id=o.parcel_id WHERE p.borough='Steglitz-Zehlendorf' AND p.locality='Lichterfelde' AND o.observation_type='land_use_eligibility_screen'");
  const distinct = scalar("SELECT count(DISTINCT o.parcel_id) FROM parcel_planning_observations o JOIN parcels p ON p.id=o.parcel_id WHERE p.borough='Steglitz-Zehlendorf' AND p.locality='Lichterfelde' AND o.observation_type='land_use_eligibility_screen'");
  assert.equal(screens, parcels);
  assert.equal(distinct, parcels);
});

databaseTest("non-building land cannot be vacancy eligible", () => {
  const violations = scalar("SELECT count(*) FROM parcel_planning_observations WHERE observation_type='land_use_eligibility_screen' AND text_value IN ('street','park','public_space') AND json_extract(evidence_json,'$.vacancyEligible')!=0");
  assert.equal(violations, 0);
});

databaseTest("material park overlap cannot be vacancy eligible", () => {
  const violations = scalar("SELECT count(*) FROM parcel_planning_observations WHERE observation_type='land_use_eligibility_screen' AND json_extract(evidence_json,'$.vacancyEligible')=1 AND json_extract(evidence_json,'$.parkOverlapShare')>=0.01");
  assert.equal(violations, 0);
});

databaseTest("every vacancy-eligible parcel is predominantly inside the uploaded Wohnbauflächen layer", () => {
  const violations = scalar("SELECT count(*) FROM parcel_planning_observations WHERE observation_type='land_use_eligibility_screen' AND json_extract(evidence_json,'$.vacancyEligible')=1 AND json_extract(evidence_json,'$.residentialOverlapShare')<0.5");
  assert.equal(violations, 0);
});

test("the source and exact-overlap method remain explicit", async () => {
  const script = await readFile(new URL("../scripts/derive-qgis-land-use-screen.mjs", import.meta.url), "utf8");
  assert.match(script, /user-qgis-lichterfelde-land-use/);
  assert.match(script, /qgis_exact_polygon_overlap_v1/);
  assert.match(script, /DOMINANT_SHARE = 0\.5/);
  assert.match(script, /PARK_EXCLUSION_SHARE = 0\.01/);
  assert.match(script, /polygonClipping\.intersection/);
  assert.match(script, /qgisParcelMatch: false/);
});

test("the deployable screen contains one compact record per parcel", async () => {
  const screen = JSON.parse(await readFile(new URL("../public/data/lichterfelde-land-use-screen.json", import.meta.url), "utf8"));
  assert.equal(screen.metadata.method, "qgis_exact_polygon_overlap_v1");
  assert.ok(screen.parcels.length > 0);
  if (database) {
    assert.equal(screen.parcels.length, scalar("SELECT count(*) FROM parcels WHERE borough='Steglitz-Zehlendorf' AND locality='Lichterfelde'"));
  }
  assert.deepEqual(Object.keys(screen.parcels[0]).sort(), ["id", "parcelUseClass", "parkOverlapShare", "publicSpaceOverlapShare", "residentialOverlapShare", "streetOverlapShare", "vacancyEligible"].sort());
});
