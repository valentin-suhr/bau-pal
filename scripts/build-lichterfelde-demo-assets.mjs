import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(field); field = ""; }
    else if (character === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (character !== "\r") field += character;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [headers, ...values] = rows.filter((candidate) => candidate.length > 1);
  return values.map((candidate) => Object.fromEntries(headers.map((header, index) => [header, candidate[index] ?? ""])));
}

function numberOrNull(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function jsonOr(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; }
  catch { return fallback; }
}

const parcelRows = parseCsv(fs.readFileSync(path.join(root, "data/exports/lichterfelde-parcels.csv"), "utf8"));
const parcels = parcelRows.map((row) => {
  const maxLegalFloorAreaSqm = numberOrNull(row.max_legal_floor_area_sqm);
  const estimatedFloorAreaSqm = numberOrNull(row.estimated_observed_floor_area_sqm);
  return {
    id: row.parcel_id,
    areaSqm: numberOrNull(row.area_sqm),
    centroidLng: numberOrNull(row.centroid_lng),
    centroidLat: numberOrNull(row.centroid_lat),
    geometry: jsonOr(row.geometry_geojson, null),
    processingStatus: "unassessed",
    legalLandUseLabel: row.legal_land_use_label || null,
    legalGrz: numberOrNull(row.legal_grz),
    legalGfz: numberOrNull(row.legal_gfz),
    legalStoreysMax: numberOrNull(row.legal_storeys_max),
    buildingForm: row.legal_building_form || null,
    maxLegalFloorAreaSqm,
    observedFootprintSqm: numberOrNull(row.observed_building_footprint_sqm),
    estimatedFloorAreaSqm,
    apparentGfz: numberOrNull(row.apparent_gfz),
    remainingFloorAreaSqm: maxLegalFloorAreaSqm == null || estimatedFloorAreaSqm == null ? null : Math.max(0, maxLegalFloorAreaSqm - estimatedFloorAreaSqm),
    occupancyScreening: row.capacity_occupancy_screening || row.occupancy_screening || null,
    controllingPlanKeys: jsonOr(row.controlling_plan_keys_json, []),
    parcelUseClass: null,
    vacancyEligible: null,
    streetOverlapShare: null,
    parkOverlapShare: null,
    publicSpaceOverlapShare: null,
    residentialOverlapShare: null,
  };
});

const locality = fs.readFileSync(path.join(root, "data/import/ortsteile.ndjson"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .find((item) => item.name === "Lichterfelde");

if (!locality) throw new Error("Lichterfelde locality boundary is missing.");

fs.writeFileSync(path.join(root, "public/data/lichterfelde-parcels-demo.json"), JSON.stringify({
  parcels,
  counts: {},
  returned: parcels.length,
  borough: "Steglitz-Zehlendorf",
  locality: "Lichterfelde",
  mode: "capacity",
  samplingApplied: false,
  caveat: "Static, source-backed Lichterfelde demo snapshot generated from the audited parcel export.",
}));

fs.writeFileSync(path.join(root, "public/data/lichterfelde-boundary.geojson"), JSON.stringify({
  type: "Feature",
  properties: { name: locality.name, officialId: locality.officialId, sourceUpdatedAt: locality.sourceUpdatedAt },
  geometry: JSON.parse(locality.geometryGeojson),
}));

console.log(JSON.stringify({ parcels: parcels.length, boundary: locality.name }));
