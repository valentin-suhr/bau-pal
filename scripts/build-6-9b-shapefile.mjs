#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "output/gis/6-9B");
mkdirSync(output, { recursive: true });

const d1Dir = resolve(root, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
const dbName = readdirSync(d1Dir).find((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite");
if (!dbName) throw new Error("Local D1 database not found");
const db = resolve(d1Dir, dbName);
const sqlite = (sql) => JSON.parse(execFileSync("sqlite3", ["-json", db, sql], { encoding: "utf8" }) || "[]");

const [document] = sqlite(`
  SELECT d.id,d.plan_key,d.title,d.plan_type,d.status,d.effective_from,
         z.geometry_geojson,z.geometry_method,z.confidence
  FROM planning_documents d JOIN planning_zones z ON z.document_id=d.id
  WHERE d.plan_key='6-9B' AND z.zone_key='6-9B:scope' LIMIT 1
`);
if (!document) throw new Error("6-9B official scope is missing");

const pdfUrl = "https://fbinter.stadt-berlin.de/ScansBPlan/06_SZ/6-9B_Abz.pdf";
const scope = {
  type: "FeatureCollection",
  name: "6-9B_scope",
  crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
  features: [{
    type: "Feature",
    geometry: JSON.parse(document.geometry_geojson),
    properties: {
      plan_key: document.plan_key,
      plan_type: document.plan_type,
      status: document.status,
      eff_date: "2017-02-17",
      geom_src: document.geometry_method,
      geom_conf: document.confidence,
      pdf_url: pdfUrl,
      grz_common: 0.25,
      form_comm: "open",
      house_form: "detached/semi-detached only",
      sty_note: "II or IV by drawn subarea; not spatially resolved",
      qa_status: "official scope; rules provisional",
    },
  }],
};

const segments = sqlite(`
  SELECT p.id AS parcel_id,p.cadastral_district_code AS cad_code,p.flur,
         p.numerator,p.denominator,p.area_sqm,
         s.coverage_ratio,s.intersection_area_sqm,s.is_controlling,
         s.precedence_rank,s.assignment_method,s.confidence,
         s.intersection_geojson
  FROM parcel_planning_segments s
  JOIN planning_documents d ON d.id=s.document_id
  JOIN parcels p ON p.id=s.parcel_id
  WHERE d.plan_key='6-9B'
  ORDER BY s.is_controlling DESC,s.coverage_ratio DESC,p.id
`);
const parcels = {
  type: "FeatureCollection",
  name: "6-9B_affected_parcels",
  crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
  features: segments.map((row) => ({
    type: "Feature",
    geometry: JSON.parse(row.intersection_geojson),
    properties: {
      parcel_id: row.parcel_id,
      cad_code: row.cad_code,
      flur: row.flur,
      numerator: row.numerator,
      denominatr: row.denominator,
      parcel_m2: row.area_sqm,
      cover_pct: Number((row.coverage_ratio * 100).toFixed(3)),
      inter_m2: Number(row.intersection_area_sqm.toFixed(2)),
      control: Boolean(row.is_controlling),
      prec_rank: row.precedence_rank,
      assign_mth: row.assignment_method,
      geom_conf: row.confidence,
      plan_key: "6-9B",
      grz_common: 0.25,
      form_comm: "open",
      sty_note: "II/IV unresolved",
      legal_note: "scope intersection; not parcel-specific rule verification",
    },
  })),
};

const scopeGeojson = resolve(output, "6-9B_scope.geojson");
const parcelsGeojson = resolve(output, "6-9B_affected_parcels.geojson");
writeFileSync(scopeGeojson, JSON.stringify(scope, null, 2));
writeFileSync(parcelsGeojson, JSON.stringify(parcels));

const rules = [
  ["rule_id","rule_type","value","page","evidence","applicability","confidence","review_status"],
  ["6-9B-r1","grz","0.25","1","Repeated Nutzungsschablone value 0,25","all drawn building subareas","medium","manual visual candidate"],
  ["6-9B-r2","building_form","open","1","Repeated Nutzungsschablone code o","all drawn building subareas","medium","manual visual candidate"],
  ["6-9B-r3","storeys_max","II or IV","1","Nutzungsschablonen differ by block/subarea","internal zone only","high","requires zone tracing"],
  ["6-9B-r4","housing_form","detached and semi-detached houses only","1","Textliche Festsetzung 1","building areas","high","manually transcribed"],
  ["6-9B-r5","buildable_envelope","blue Baugrenzen","1","Drawn blue building boundaries","internal zone only","high","not yet vectorized"],
  ["6-9B-r6","land_use","not fixed by this simple B-Plan export","1","Simple B-Plan; other applicable planning instruments must be checked","document","high","legal-stack review required"],
];
const csv = (value) => `"${String(value).replaceAll('"', '""')}"`;
writeFileSync(resolve(output, "6-9B_rules.csv"), rules.map((row) => row.map(csv).join(",")).join("\n") + "\n");

const ogr2ogr = "/Applications/QGIS.app/Contents/MacOS/ogr2ogr";
const qgisEnvironment = {
  ...process.env,
  PROJ_LIB: "/Applications/QGIS.app/Contents/Resources/qgis/proj",
  GDAL_DATA: "/Applications/QGIS.app/Contents/Resources/qgis/gdal",
};
execFileSync(ogr2ogr, ["-overwrite", "-f", "ESRI Shapefile", "-t_srs", "EPSG:25833", resolve(output, "6-9B_scope.shp"), scopeGeojson], { stdio: "inherit", env: qgisEnvironment });
execFileSync(ogr2ogr, ["-overwrite", "-f", "ESRI Shapefile", "-t_srs", "EPSG:25833", resolve(output, "6-9B_affected_parcels.shp"), parcelsGeojson], { stdio: "inherit", env: qgisEnvironment });
writeFileSync(resolve(output, "6-9B_scope.cpg"), "UTF-8\n");
writeFileSync(resolve(output, "6-9B_affected_parcels.cpg"), "UTF-8\n");

const manifest = {
  schema: "bau-pal-bplan-shapefile-pilot-v1",
  planKey: "6-9B",
  createdAt: new Date().toISOString(),
  crs: "EPSG:25833",
  sourcePdf: pdfUrl,
  sourcePdfLocal: "data/documents/bplans/6-9B--plan_sheet.pdf",
  officialScopeSource: "Geoportal Berlin WFS Bebauungsplanverfahren, feature b_bp_fs.0600009B",
  files: ["6-9B_scope.shp", "6-9B_affected_parcels.shp", "6-9B_rules.csv"],
  counts: { scopeFeatures: 1, affectedParcelParts: parcels.features.length, controllingParcelParts: parcels.features.filter((feature) => feature.properties.control).length },
  limitations: [
    "The plan scope is official vector geometry; it is not traced from PDF pixels.",
    "Affected parcel geometries are clipped ALKIS intersections with the official scope.",
    "GRZ 0.25 and open construction are repeated visual candidates, not parcel-level verified rules.",
    "II/IV storey subareas, blue building boundaries, red building lines, preservation areas and special structures remain to be georeferenced and traced.",
    "Land use and GFZ are not asserted by this export; the complete legal planning stack must be checked.",
  ],
};
writeFileSync(resolve(output, "6-9B_manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(resolve(output, "README.txt"), `B-Plan 6-9B pilot shapefile export\n\nCRS: EPSG:25833\n\n6-9B_scope.* is the official plan scope.\n6-9B_affected_parcels.* contains ALKIS parcel intersections with coverage fields.\n6-9B_rules.csv records document-level and unresolved internal-zone evidence.\n\nThis is a GIS working dataset, not an official parcel-specific planning statement. See 6-9B_manifest.json for limitations.\n`);

console.log(JSON.stringify(manifest.counts, null, 2));
