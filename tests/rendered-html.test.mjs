import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const cssUrl = new URL("../app/globals.css", import.meta.url);
const globeUrl = new URL("../components/LichterfeldeGlobe.tsx", import.meta.url);
const demoParcelsUrl = new URL("../public/data/lichterfelde-parcels-demo.json", import.meta.url);
const boundaryUrl = new URL("../public/data/lichterfelde-boundary.geojson", import.meta.url);
const processedPlansUrl = new URL("../public/data/lichterfelde-processed-bplans.geojson", import.meta.url);
const mapApiUrl = new URL("../app/api/parcels/map/route.ts", import.meta.url);
const exportScriptUrl = new URL("../scripts/export-parcel-table.mjs", import.meta.url);
const exportAuditUrl = new URL("../scripts/audit-parcel-export.mjs", import.meta.url);

test("renders the focused Lichterfelde opportunity demo", async () => {
  const page = await readFile(pageUrl, "utf8");
  assert.match(page, /bau pal/);
  assert.doesNotMatch(page, /Our mission|Find potential\. <em>Build together/);
  assert.match(page, /Explore vacant or underutilised plots/);
  assert.match(page, /className="mission-banner"/);
  assert.match(page, /className="control-panel analysis-panel"/);
  assert.match(page, /className="control-panel build-panel"/);
  assert.doesNotMatch(page, /analysisTab|panel-tabs/);
  assert.match(page, /const EU_COUNTRIES = \[/);
  assert.match(page, /const MAJOR_EU_CITIES = \[/);
  assert.match(page, /const BERLIN_LOCALITIES = \[/);
  assert.match(page, /District \/ locality/);
  assert.match(page, /Lichterfelde/);
  assert.match(page, /Vacant plots only/);
  assert.match(page, /Underutilised plots/);
  assert.match(page, /Street — excluded/);
  assert.match(page, /Residential candidate/);
  assert.match(page, /RESIDENTIAL_MASK_MIN_SHARE = 0\.5/);
  assert.match(page, /PARK_EXCLUSION_MIN_SHARE = 0\.01/);
  assert.match(page, /isInsideResidentialMask/);
  assert.doesNotMatch(page, /Primary navigation|Search|Notifications|className="nav-actions"/);
  assert.doesNotMatch(page, /className="map-caption"|screened opportunities|non-building or review parcels withheld/);
  assert.doesNotMatch(page, /Land use unresolved|className="code-line"/);
  assert.match(page, /if \(!isInsideResidentialMask\(parcel\)\) return 0/);
  assert.match(page, /streetOverlapShare/);
  assert.match(page, /Heat map/);
  assert.doesNotMatch(page, /Zoning overlay|zoningOverlay|parcel\.zoned/);
  assert.doesNotMatch(page, /Your building goals|Apartment units|Update potential|Storeys \(target\)|Parking spaces/);
  assert.match(page, /Shortlist selected/);
  assert.match(page, /Plot results/);
  assert.ok(page.indexOf("Plot results") < page.indexOf("Selected plot"));
  assert.doesNotMatch(page, /New project|Load project/);
  assert.match(page, /https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
  assert.match(page, /Open in Google Maps/);
  assert.match(page, /centroidLat\.toFixed\(6\)/);
  assert.match(page, /Prototype estimate/);
  assert.match(page, /imputed placeholders, not trained-model output/);
  assert.doesNotMatch(page, /heritage|monument/i);
});

test("offers a maneuverable 2D and 3D parcel map", async () => {
  const [page, css, globe] = await Promise.all([readFile(pageUrl, "utf8"), readFile(cssUrl, "utf8"), readFile(globeUrl, "utf8")]);
  assert.match(page, /changeViewMode\("2d"\)/);
  assert.match(page, /changeViewMode\("3d"\)/);
  assert.match(page, /startDrag/);
  assert.match(page, /moveDrag/);
  assert.match(page, /onPointerMove/);
  assert.match(page, /onWheel/);
  assert.match(page, /Reset map/);
  assert.match(page, /GLOBE_CIRCUMFERENCE_RATIO = 1\.25/);
  assert.match(page, /\(2 \* Math\.PI\) \/ GLOBE_CIRCUMFERENCE_RATIO/);
  assert.match(page, /globeScale/);
  assert.match(page, /globe-assembly/);
  assert.match(css, /\.is-3d \.globe-assembly/);
  assert.match(css, /\.globe-canvas/);
  assert.match(css, /\.is-2d \.world-map/);
  assert.match(globe, /new THREE\.WebGLRenderer/);
  assert.match(globe, /new THREE\.SphereGeometry/);
  assert.match(globe, /buildParcelGeometry/);
  assert.match(globe, /buildBuildingGeometry/);
  assert.match(globe, /buildGroundGeometry/);
  assert.match(globe, /color: 0xb8d5bd/);
  assert.match(globe, /color: 0x4f8160/);
  assert.match(globe, /groundOutline/);
  assert.match(globe, /const baseRadius = 1\.006/);
  assert.match(globe, /attribute\.needsUpdate = true/);
  assert.match(globe, /THREE\.ShapeUtils\.triangulateShape/);
  assert.match(globe, /const point = contour\[vertexIndex\]/);
  assert.doesNotMatch(globe, /triangle\.map\(\(point\) => spherePoint\(point\.x/);
  assert.match(globe, /reversed underside caps make every radial extrusion watertight/);
  assert.match(globe, /addTriangle\(positions, bottom\[2\], bottom\[1\], bottom\[0\]\)/);
  assert.match(globe, /new THREE\.BufferGeometry/);
  assert.match(globe, /longitude = \(v - 0\.5\) \* surfaceSpanRadians/);
  assert.match(globe, /Rotatable vector 3D model/);
  assert.match(globe, /buildPlanOutlineGeometry/);
  assert.match(globe, /raycaster\.params\.Line\.threshold/);
  assert.match(globe, /selectPlanHandlerRef/);
  assert.doesNotMatch(globe, /CanvasTexture|svgTexture/);
  assert.match(css, /\.parcel-base/);
  assert.doesNotMatch(css, /opacity:\s*\.\d+[^}]*confidence/i);
});

test("shows clickable official scopes for processed Lichterfelde B-Plans", async () => {
  const [page, css, planText] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(cssUrl, "utf8"),
    readFile(processedPlansUrl, "utf8"),
  ]);
  const collection = JSON.parse(planText);
  assert.match(page, /lichterfelde-processed-bplans\.geojson/);
  assert.match(page, /Processed B-Plan outlines/);
  assert.match(page, /processed-plan-outline/);
  assert.match(page, /setSelectedPlanKey\(plan\.properties\.planKey\)/);
  assert.match(page, /selectedPlan\.properties\.title/);
  assert.match(page, /Machine-extracted; not yet a legal verification/);
  assert.match(css, /\.processed-plan-outline/);
  assert.match(css, /\.plan-selection-card/);
  assert.equal(collection.features.length, 14);
  assert.equal(new Set(collection.features.map((feature) => feature.properties.planKey)).size, 14);
  for (const feature of collection.features) {
    assert.match(feature.geometry.type, /^(Multi)?Polygon$/);
    assert.equal(feature.properties.geometrySource, "official_vector");
    assert.ok(["machine_extracted", "verified"].includes(feature.properties.processingStatus));
  }
});

test("maps real capacity fields and exposes source caveats", async () => {
  const [page, mapApi] = await Promise.all([readFile(pageUrl, "utf8"), readFile(mapApiUrl, "utf8")]);
  assert.match(page, /lichterfelde-parcels-demo\.json/);
  assert.match(page, /lichterfelde-boundary\.geojson/);
  assert.match(page, /lichterfelde-alkis-buildings\.geojson/);
  assert.match(page, /lichterfelde-land-use-screen\.json/);
  assert.match(page, /capacityStatus/);
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
  assert.match(mapApi, /land_use_eligibility_screen/);
  assert.match(mapApi, /qgis_exact_polygon_overlap_v1/);
  assert.match(mapApi, /vacancyEligible/);
  assert.match(mapApi, /'street'/);
  assert.match(mapApi, /'park'/);
});

test("ships a complete, database-independent Lichterfelde demo snapshot", async () => {
  const [parcelText, boundaryText] = await Promise.all([readFile(demoParcelsUrl, "utf8"), readFile(boundaryUrl, "utf8")]);
  const snapshot = JSON.parse(parcelText);
  const boundary = JSON.parse(boundaryText);
  assert.equal(snapshot.parcels.length, 12677);
  assert.equal(snapshot.returned, 12677);
  assert.equal(boundary.properties.name, "Lichterfelde");
  assert.match(boundary.geometry.type, /Polygon/);
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

test("marks parcels with complete GRZ and GFZ evidence with a purple point layer", async () => {
  const [page, css, globe] = await Promise.all([readFile(pageUrl, "utf8"), readFile(cssUrl, "utf8"), readFile(globeUrl, "utf8")]);
  assert.match(page, /const COMPLETE_DENSITY_COLOUR = "#43116f"/);
  assert.match(page, /parcel\.legalGrz != null && parcel\.legalGfz != null/);
  assert.match(page, /GRZ \+ GFZ available/);
  assert.match(page, /completeDensityEvidence,/);
  assert.match(page, /className="density-evidence-layer"/);
  assert.match(page, /className="density-evidence-dot"/);
  assert.match(page, /Show GRZ and GFZ evidence dots/);
  assert.match(page, /showDensityDots \? <g className="density-evidence-layer"/);
  assert.match(page, /completeDensityEvidence: showDensityDots && completeDensityEvidence/);
  assert.match(css, /\.density-evidence-dot \{ fill: #43116f/);
  assert.match(globe, /outlineColours/);
  assert.match(globe, /parcel\.completeDensityEvidence/);
  assert.match(globe, /evidenceDotPositions/);
  assert.match(globe, /new THREE\.Mesh\(parcelLayer\.evidenceDots/);
  assert.match(globe, /geometryVersion, parcels, planOutlines/);
  assert.match(globe, /vertexColors: true/);
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
