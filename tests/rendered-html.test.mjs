import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const cssUrl = new URL("../app/globals.css", import.meta.url);
const mapApiUrl = new URL("../app/api/parcels/map/route.ts", import.meta.url);
const exportScriptUrl = new URL("../scripts/export-parcel-table.mjs", import.meta.url);
const exportAuditUrl = new URL("../scripts/audit-parcel-export.mjs", import.meta.url);

test("renders the focused Lichterfelde opportunity demo", async () => {
  const page = await readFile(pageUrl, "utf8");
  assert.match(page, /bau pal/);
  assert.match(page, /Find potential/);
  assert.match(page, /Build <em>together/);
  assert.match(page, /Lichterfelde, Berlin/);
  assert.match(page, /Vacant plots only/);
  assert.match(page, /Underutilised plots/);
  assert.match(page, /Heat map/);
  assert.match(page, /Apartment units/);
  assert.match(page, /Update potential/);
  assert.match(page, /Prototype estimate/);
  assert.match(page, /imputed placeholders, not trained-model output/);
  assert.doesNotMatch(page, /heritage|monument/i);
});

test("offers a maneuverable 2D and 3D parcel map", async () => {
  const [page, css] = await Promise.all([readFile(pageUrl, "utf8"), readFile(cssUrl, "utf8")]);
  assert.match(page, /setViewMode\("2d"\)/);
  assert.match(page, /setViewMode\("3d"\)/);
  assert.match(page, /startDrag/);
  assert.match(page, /moveDrag/);
  assert.match(page, /onPointerMove/);
  assert.match(page, /onWheel/);
  assert.match(page, /Reset map/);
  assert.match(css, /\.is-3d \.world-map/);
  assert.match(css, /\.is-2d \.world-map/);
  assert.match(css, /\.parcel-base/);
  assert.doesNotMatch(css, /opacity:\s*\.\d+[^}]*confidence/i);
});

test("maps real capacity fields and exposes source caveats", async () => {
  const [page, mapApi] = await Promise.all([readFile(pageUrl, "utf8"), readFile(mapApiUrl, "utf8")]);
  assert.match(page, /\/api\/parcels\/map/);
  assert.match(page, /lichterfelde-alkis-buildings\.geojson/);
  assert.match(page, /remainingFloorAreaSqm/);
  assert.match(page, /maxLegalFloorAreaSqm/);
  assert.match(page, /legalGfz/);
  assert.match(page, /legalGrz/);
  assert.match(page, /not legal advice/);
  assert.match(mapApi, /'vacant'/);
  assert.match(mapApi, /'high_potential'/);
  assert.match(mapApi, /'moderate_potential'/);
  assert.match(mapApi, /maxLegalFloorAreaSqm/);
  assert.match(mapApi, /estimatedFloorAreaSqm/);
  assert.match(mapApi, /remainingFloorAreaSqm/);
  assert.match(mapApi, /controllingPlanKeys/);
});

test("keeps the demo valuation explicitly assumption-driven", async () => {
  const page = await readFile(pageUrl, "utf8");
  assert.match(page, /const MARKET/);
  assert.match(page, /landPerSqm/);
  assert.match(page, /constructionPerSqm/);
  assert.match(page, /realizationFactor/);
  assert.match(page, /Imputed land value/);
  assert.match(page, /Indicative development upside/);
});

test("makes scoped CSV exports self-auditing", async () => {
  const [script, audit] = await Promise.all([readFile(exportScriptUrl, "utf8"), readFile(exportAuditUrl, "utf8")]);
  assert.match(script, /coverageChecks/);
  assert.match(script, /rowFoundationComplete/);
  assert.match(script, /populatedLegalValuesHaveResolutionMethod/);
  assert.match(script, /complete_core_profile/);
  assert.match(script, /AS core_completeness/);
  assert.match(script, /constraint_status/);
  assert.match(script, /coveragePass/);
  assert.match(audit, /artifactStatus/);
  assert.match(audit, /missingColumns/);
  assert.match(audit, /expectedSchemaVersion/);
  assert.match(audit, /regenerationCommand/);
});
