# bau pal

**Find potential. Build together.**

bau pal is an evidence-aware parcel screening prototype for cohousing and
group-build projects. The current MVP focuses on Lichterfelde, Berlin: it maps
vacant and underused residential candidates, visualises indicative development
potential, and clearly distinguishes sourced planning values from estimates.

![bau pal — Lichterfelde parcel intelligence](public/og.png)

## Portfolio highlights

- Interactive 2D map and a custom Three.js “micro-globe” representation.
- Parcel-level heat map for vacancy and underutilisation screening.
- Filterable purple point layer for parcels with both GRZ and GFZ evidence.
- ALKIS parcels and buildings combined with QGIS-derived residential, street,
  park and public-space screens.
- Clickable processed B-Plan scopes with source links and plan identifiers.
- Parcel results, indicative capacity, Google Maps links and a local shortlist.
- Reproducible OCR/georeferencing experiments for raster B-Plans, including
  local and Google Colab workflows.
- Deterministic QA checks that prevent non-building land from becoming a
  development candidate.

## Demo scope

This repository includes a self-contained Lichterfelde demo snapshot, so the
main interface can run without a database or private credentials. It is a
screening and research prototype—not a planning permission, valuation, vacancy
register or legal opinion. Values labelled as estimates are deliberately kept
separate from official or manually reviewed evidence.

## Run locally

Requirements: Node.js 22.13 or newer and npm.

```bash
git clone <your-github-repository-url>
cd baugruppe-dashboard
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Validate a change with:

```bash
npm run lint
npm test
```

## Architecture at a glance

```text
Berlin open geodata + reviewed B-Plans + QGIS layers
                         │
              import / spatial QA scripts
                         │
         normalised D1 evidence and planning model
                         │
          bounded, database-independent demo assets
                         │
        React/vinext dashboard + Three.js micro-globe
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for component boundaries and
[docs/DATA_AND_LIMITATIONS.md](docs/DATA_AND_LIMITATIONS.md) for provenance,
confidence and interpretation rules.

## Technology

React 19 · TypeScript · vinext/Vite · Three.js · Cloudflare D1/Drizzle ·
GeoJSON · Node.js spatial ETL · Python/Colab OCR experiments

## Repository map

| Path | Purpose |
| --- | --- |
| `app/` | Dashboard UI and parcel APIs |
| `components/` | Interactive Three.js Lichterfelde globe |
| `public/data/` | Bounded, deployable Lichterfelde demo assets |
| `db/`, `drizzle/` | Normalised evidence and planning schema |
| `scripts/` | Import, spatial assignment, extraction and QA workflows |
| `pipeline/` | Raster B-Plan OCR/vectorisation prototype |
| `analysis/` | Reproducible Colab notebooks and analysis helpers |
| `tests/` | UI contracts and geospatial data-quality checks |

## Technical reference

The remainder of this document records the detailed parcel-data and B-Plan
processing workflow behind the prototype.

## Parcel data model

The D1 schema is intentionally normalised:

- `parcels` contains ALKIS geometry, official area and cadastral identifiers.
- `planning_documents` and `planning_document_relations` represent the legal
  plan stack, including amendments and partial supersession.
- `planning_zones` stores the spatial reach of each plan or sub-zone.
- `planning_rules` records individual rules with their source, extraction
  method, confidence and review status.
- `parcel_planning_segments` stores parcel/zone intersections. This prevents a
  parcel spanning two zones from being forced into one inaccurate classification.
- `parcel_development_profiles` is the dashboard-ready resolved record. Null
  legal values mean "not established" and are kept separate from observed
  neighbourhood estimates under section 34 BauGB.

The API endpoint `GET /api/parcels` accepts `bbox`, `borough`, `regime`, `limit`
and `offset`. It returns parcel geometry together with any resolved planning
profile and a visible legal-data caveat.

`GET /api/parcels/:id/planning` returns the audit trail for one parcel: every
intersecting plan scope, coverage ratio, precedence state, extracted rule,
source locator, confidence and review status. An overlap is a candidate until
the legal stack has been resolved.

## Importing Berlin ALKIS parcels

After the parcel import, `npm run import:ortsteile` downloads Berlin's 97 official ALKIS Ortsteil polygons and `npm run assign:localities` joins parcel centroids to them. The enriched extract also carries a former-East/former-West **workflow proxy** for parcels outside B-Plans. `npm run refine:historical-sector` independently checks that proxy against Berlin's official 1989 wall-line WFS. BNP routing is accepted only when both signals agree and the parcel centroid is more than 150 m from the line; disagreements and near-line parcels are assigned `historical_boundary_review` and BNP applicability is withheld. The wall dataset is explicitly not parcel-accurate and reflects 1989 rather than the BNP adoption date, so even corroborated results remain medium-confidence routing context—not a legal determination.

`npm run import:alkis-buildings` imports the official ALKIS building/building-part layer. `npm run derive:building-context` computes reproducible physical occupancy screening for every parcel plus 50 m/100 m neighbourhood metrics, and `npm run derive:building-context:sql` emits observation inserts. A parcel is labelled `building_centre_detected` when at least one official ALKIS building or building-part centre lies inside its geometry; otherwise it is labelled `no_building_centre_detected`. The latter is only a medium-confidence possible-vacancy candidate: a footprint can cross the parcel boundary while its centre lies outside, and the source can omit or lag physical changes. These observations do not establish legal vacancy, development readiness, ownership availability, or whether §34 or §35 BauGB applies.

After loading the normalized evidence tables into local D1, `npm run profiles:initialize` creates one conservative dashboard-facing development profile per parcel. A §30 subtype is assigned only after scope-level control is resolved; B-Plan substantive fields remain null until their controlling internal zone and rule source are resolved.

`npm run profiles:resolve-bnp` applies a deliberately narrow machine-resolution rule to the Baunutzungsplan branch. A parcel must have corroborated former-West routing, no historical-boundary review flag, medium-confidence Baustufe and land-use observations, an unambiguous land-use class, at least 70% raster sample agreement, at least 50% classified-pixel coverage, and complete cited BNP/BO 1958 codebook entries. Passing parcels receive GRZ, GFZ, BMZ, storeys, height, building form and permitted uses at **medium confidence / machine checked**. They still carry unresolved manual checks for exact legal boundaries, land use, Baustufe, surviving Fluchtlinien and other constraints; this is not an official parcel-specific planning statement.

Run `npm run profiles:resolve-bplan-precedence` after segment imports. It marks
either a single scope covering at least 99% of the parcel or, for an overlapping
stack, a unique ≥99%-coverage plan that transitively supersedes every other
scope on that parcel according to Berlin's official `ersetzt` / `ersetzt
teilweise` relations. Partial supersession is used only inside the newer plan's
near-total parcel intersection. All other plans remain candidates, and the
dashboard/API expose candidate and controlling plan keys separately.

`npm run profiles:resolve-bplan-single-zone-pilots` currently records four visually reviewed parcel-specific B-Plan matches (`1-16VE`, `1-38VE`, `1-45VE` and `I-20`). Each official scope controls one cadastral parcel at at least 99% coverage and the sheet contains one substantive use zone. The resolver records permitted use, any absolute maximum floor area, and cited ancillary/height constraints. It deliberately does **not** convert absolute GF into GFZ or treat total ancillary-coverage figures as principal-building GRZ. `I-20` is a use-only school/sports-hall profile because the sheet does not establish parcel-wide density values. Drawn footprints, storeys, building form and subarea details remain unresolved. This is the pilot pattern for expanding reviewed internal-zone coverage.

`npm run profiles:resolve-bplan-reviewed-parcels` adds reviewed composite-parcel profiles for `1-89VE` and `I-43bVE`. These sheets support parcel-wide absolute GF and maximum-storey values, but contain named use or height subareas. The profile therefore preserves conditional permitted-use text and subarea constraints instead of pretending the parcel is uniform.

`npm run profiles:resolve-bplan-qualified-single-zone` records a fully dimensional reviewed match for `XX-247-1`: WA, GRZ 0.20, GFZ 0.40, two full storeys, open construction, and detached/semi-detached houses only. Absolute eaves/ridge elevations and landscaping conditions are retained separately; the drawn building envelope remains unresolved.

`npm run profiles:resolve-bplan-use-storey` records reviewed use-and-storey profiles for `I-55` (MK, maximum VII) and `XX-264` (WA, maximum V). Incorporated BauNVO use catalogues preserve regular versus exceptional permissions. GRZ, GFZ, form, footprint and the exact internal storey subareas remain null/unresolved.

`npm run profiles:resolve-bplan-special-land` records three visually matched non-building-land profiles: `12-1` is fixed as private permanent allotments, with non-residential one-storey huts limited to 24 m² per allotment and a potentially admissible purpose-compatible clubhouse; cadastral parcel 43 in `I-9` is fixed as public street-traffic area; and cadastral parcel 383 in `II-200ib` is fixed as B 96 federal-road traffic area. These profiles explicitly prevent the dashboard from presenting these parcels as ordinary residential development land. Internal easement, street, planting and tunnel geometries remain unresolved.

`npm run queue:bplan-zone-review` also overlays visually verified routing decisions from `data/qa/bplan-manual-review-dispositions.json`. Plans whose sheets reveal internal use, density, height or community-facility subareas are moved to `requires_internal_zone_georeferencing`, even when document-level counts made them look like single-zone candidates. Sheets carrying partial-invalidity or similar legal-effect notices are instead moved to `requires_legal_effect_review`. Each override retains the reviewed sheet and reason so unresolved plans are not repeatedly reviewed or accidentally promoted.

The single-zone lane is intentionally restricted to plans controlling exactly one current ALKIS parcel at at least 99% coverage. Any unresolved plan controlling multiple current parcels is routed to parcel-zone allocation/georeferencing by default, because document-level uses and project-wide density or floor-area caps cannot safely be copied to every parcel row.

Printed DHDN / Soldner Berlin coordinate grids can be converted into affine control points with `npm run extract:soldner-grid-controls -- <map-crop.png> <grid-config.json> <controls.json>`. The grid config supplies visible easting labels from left to right, northing labels from top to bottom, and the crop origin in the full plan render. The detector finds long neutral-dark lines, fits their slight scan skew, intersects them, converts EPSG:3068 coordinates to WGS84, and rejects irregular spacing, inadequate span, or excessive affine residual. Reading the printed coordinate labels and selecting a crop that isolates the map remain review tasks; a passing result is a georeferencing aid, not a legal-content completeness decision. `data/georeferencing/bplans/I-8.soldner-grid.json` is the validated example. `npm run inventory:soldner-grid-candidates` uses extracted sheet text to find runs of likely 100-m grid labels and writes a conservative OCR-based triage list; it never assigns axes or promotes a plan automatically.

`npm run georef:bplan-zones -- INPUT.json OUTPUT.geojson` transforms reviewed pixel-space zone traces into WGS84 using an affine fit from at least three control points. Input uses schema `bplan-pixel-trace-v1` and must include `planKey`, `sourcePdf`, render metadata, control points shaped as `{ "pixel": [x,y], "world": [longitude,latitude] }`, QA thresholds, and a GeoJSON FeatureCollection of pixel-space zones with `zoneKey` and `label`. The command writes coefficients, per-control-point residuals, RMS/max residuals, source provenance and transformed zone bboxes; it fails rather than exporting when residual thresholds are exceeded. This makes each traced internal zone reproducible and reviewable before it is intersected with ALKIS parcels.

`npm run georef:bplan-zones:sql -- OUTPUT.geojson OUTPUT.sql` converts a QA-passed zone artifact into idempotent D1 inserts for `planning_zones` and `planning_zone_geometry_reviews`. The review row preserves the source plan-sheet asset, page, render parameters, raw control points, affine coefficients, residuals, QA thresholds, trace version and review/update timestamps alongside each imported zone.

Traced features may contain typed `rules`, and an artifact may contain plan-level rules with an optional `zoneKey`. The importer distinguishes `zone_rule` from `document_rule`, preserves numeric values, units, legal citations, interpretation, confidence and review status, and replaces only rules from the same source sheet/page. Absolute floor-area caps use `floor_area_max_sqm` rather than GFZ; heights stated above NHN use `absolute_elevation_max_m` rather than a relative building-height field.

`npm run assign:bplan-zones -- --zones=OUTPUT.geojson --output=SEGMENTS.ndjson` intersects every QA-passed internal zone with the citywide ALKIS parcel extract. It derives the § 30 legal-regime branch from the official plan type, preserves the zone confidence and clipped geometry, and emits parcel-zone coverage and area for the existing planning-segment SQL importer. Zone artifacts may also carry a manually verified `landUseCode`; the georeferencing SQL importer stores that as a zone-specific rule rather than a document-wide rule.

`I-203.pixel-trace.json` is the first production artifact through this workflow. Its WA, public-park and street-traffic zones are registered to the official WFS scope at 1.43 m RMS / 1.44 m maximum residual and produce 14 current ALKIS parcel-zone intersections. `I-8.pixel-trace.json` uses nine printed EPSG:3068 Soldner-Berlin grid intersections and reaches 0.04 m RMS residual; its broad public-green-space/traffic partition produces 13 parcel-zone intersections. The Berlin export includes these as `bplan_internal_zones_json`, retaining plan/zone keys, labels, coverage, intersection area, land-use code, geometry confidence, review status, RMS residual and plan-level completeness flags. The dominant use is not silently copied into the parcel's legal profile when a parcel crosses multiple zones.

`npm run profiles:resolve-i14a-cadastral-use` applies a separately audited cadastral-overlay lane for I-14a. Six current controlling ALKIS parcels were visually registered against the official sheet using 16 printed Soldner Berlin Netz 88 intersections (0.075 m RMS / 0.134 m maximum residual). Parcel 295 is recorded as WA2; parcels 293 and 296-299 are WA1, with their distinct plan-specific housing restrictions. GRZ, GFZ, storeys, building envelopes, NHN heights and other overlays remain null or explicitly unresolved because those constraints vary within the parcels or require legal interpretation. The plan therefore remains `partially_georeferenced`.

`npm run build:cadastral-use-overlay:sql -- SPEC.json OUTPUT.sql` generalizes that reviewed cadastral-overlay lane. The spec must enumerate exact parcel IDs and zone-scoped rules; the generator embeds the control points, transform, residuals, source sheet, completeness flags and current ALKIS geometry into reproducible SQL. I-57 is the second production use: the 200 dpi / 1:1000 scale-spacing gate prevents legend strokes from masquerading as the coordinate grid, and the accepted 16-point fit reaches 0.837 m RMS / 1.477 m maximum residual. Parcels 87, 239 and 241 are WA; parcels 288 and 342 are broad public green space. Edge parcels 240 and 242 remain unresolved, as do internal park purposes and all WA envelope/storey/height subareas.

When a gray plan background prevents reliable line detection but the sheet publishes a coordinate register, `npm run build:soldner-anchor-controls -- CONFIG.json CONTROLS.json` constructs controls from the printed anchor and nominal plan scale while preserving a separate estimated registration uncertainty. Plan 1-47 uses its published point X (`y 22429.74`, `x 23572.77`) and 1:1000 scale; the resulting ALKIS overlay has a declared 0.381 m anchor uncertainty. Parcel 370 is public park and parcels 464, 467 and 468 have the broad Gewerbegebiet use. Boundary sliver 466, GE1/GE2 assignment, retail/noise subareas, GRZ interpretation, envelopes, storeys and NHN heights remain unresolved.

Plan-level completeness is stored separately in `planning_document_zone_reviews`. A manually checked trace can therefore resolve the land-use partition while explicitly leaving density, height, building form or other overlays incomplete. The review queue uses `partially_georeferenced` until the scope partition and all five constraint families are manually verified; the existence of a georeferenced polygon alone never marks a plan resolved.

I-203 now also retains its traced building envelope and TG1 garage envelope, the absolute GF 11,500 m² project cap, TH 52.0 m above NHN, and textual constraints 1-9 as typed rules. It remains partial because the exact geometry of area A for the 3 m utility easement is not yet proven; the absolute project cap is deliberately not copied into each current parcel profile.

The export and parcel-list API also expose a conservative flattened `bplan_dominant_*` view. A dominant internal use is emitted only when the official plan scope is controlling, the plan-level land-use partition is manually complete, exactly one reviewed land-use zone covers at least 95% of the parcel, and no second land-use zone covers 5% or more. The fields keep project-wide floor-area caps and absolute NHN elevations under explicit names; they never populate parcel GFZ or relative-height fields. `npm run audit:export:bplan-zones` scans all 403,484 rows and verifies these invariants plus known mixed and dominant production parcels.

`npm run queue:bplan-zone-review` regenerates `data/qa/bplan-zone-review-queue.json`. It ranks controlling plans with downloaded sheets, near-total parcel coverage, one or no substantive official use classes and no conflicting extracted dimensional values for visual single-zone review. The queue is triage only: it never promotes document-level mentions to parcel rules.

`npm run inventory:soldner-grid-candidates` excludes plans whose manual disposition already proves that a registered cadastral overlay cannot yield a broad parcel-wide use. For example, I-214 remains in the full internal-zone lane because current parcels cross MK1/MK2, two distinct government special areas, school/youth-club land, a substation and traffic land. This keeps the grid candidate list focused on untouched plans without disguising reviewed complex plans as failed automation.

`npm run audit:local-d1` discovers the current Miniflare D1 file, verifies one jurisdiction and one development profile per parcel, reports evidence-table counts and confirms that populated BNP values exactly match the strict evidence gates and cited codebook while B-Plan text mentions remain unpromoted.

`npm run audit:objective-coverage` is a read-only coverage contract for the Berlin-wide end state. It reports citywide and borough-level coverage for geometry/location, workflow routing, statutory regime, land use, permitted uses, GRZ, GFZ, storeys, building form, constraint-status encoding, confidence and update status. Its `complete_core_profile` definition requires resolved use and permitted uses plus GRZ, GFZ, maximum storeys and building form; routed or candidate evidence is not counted as complete legal data.

`npm run export:parcels` creates the complete gzip-compressed CSV and checksum
manifest under `data/exports/`. `npm run audit:export` independently verifies
the checksum, 403,484-row invariant and required legal/provenance columns.

`npm run import:inspire-bplan-documents` imports Berlin's official INSPIRE `OfficialDocumentation` records. These enrich existing plan-sheet and rationale assets with citation dates and dates entered into force where published. The service exposes plan scopes and documentation, but currently no internal `ZoningElement` layer; internal parcel rules therefore still require plan-sheet extraction and spatial review.

The importer reads the official Berlin ALKIS Flurstuecke WFS in pages and writes
normalised newline-delimited JSON:

```bash
npm run import:alkis -- --output=data/import/alkis-parcels.ndjson
```

For a bounded development/test import:

```bash
npm run import:alkis -- \
  --bbox=13.329,52.492,13.333,52.495 \
  --limit=100 \
  --output=data/import/wilmersdorf-sample.ndjson
```

Convert an extract to idempotent D1 upserts after applying the generated
Drizzle migration:

```bash
npm run import:alkis:sql -- \
  --input=data/import/alkis-parcels.ndjson \
  --output=data/import/alkis-parcels.sql
```

The importer never supplies GRZ, GFZ or storeys. Those fields enter the system
only through a cited planning rule and the subsequent legal-stack resolution.

## Importing official B-Plan scopes

Berlin's official B-Plan WFS publishes plan boundaries and procedure metadata.
Import the in-force layer with:

```bash
npm run import:bplans -- --layer=fixed --output=data/import/bplans-fixed.ndjson
npm run import:bplans:sql -- \
  --input=data/import/bplans-fixed.ndjson \
  --output=data/import/bplans-fixed.sql
```

The importer also accepts `--layer=process` and `--layer=repealed`, plus the
same `--bbox`, `--limit` and `--page-size` controls as the parcel importer.
The scope geometry is an official vector, but it is not an internal land-use
zone and does not contain GRZ, GFZ or storey limits. Those rules must be read
from the plan sheet, text stipulations and rationale with citations.

## Assigning parcels to plans

Calculate exact parcel/plan intersections offline and convert them to D1 SQL:

```bash
npm run assign:planning -- \
  --parcels=data/import/alkis-parcels.ndjson \
  --plans=data/import/bplans-fixed.ndjson \
  --output=data/import/parcel-planning-segments.ndjson
npm run assign:planning:sql -- \
  --input=data/import/parcel-planning-segments.ndjson \
  --output=data/import/parcel-planning-segments.sql
```

All intersections are retained. A broad transition plan and a later B-Plan can
legitimately overlap, and plan supersession can be partial. A separate resolver
must rank the legal stack before setting `is_controlling` or filling a parcel's
development profile. Parcels with no controlling B-Plan then move to the
Baunutzungsplan / building-line / section 34 or section 35 branch.

## Legal-document acquisition

Create the official B-Plan asset inventory, download a bounded or complete
queue, and route PDFs with insufficient embedded text to OCR:

```bash
npm run inventory:bplan-assets
npm run select:bplan-priority-assets -- --limit=100
npm run download:bplan-assets -- --limit=100 --concurrency=4
npm run extract:bplan-text
npm run ocr:bplan-assets -- --asset-type=plan_sheet --dpi=140
npm run extract:bplan-wfs-rules
```

Downloaded files record their source URL, retrieval time, HTTP metadata,
SHA-256 hash, size, MIME type, page count, embedded-text count, OCR state,
extraction version and review state. WFS `inhalt` land uses are stored with
`applicability=document_summary`; they are not parcel-specific zone rules.
Scanned sheets are rendered locally and recognized with a project-pinned
Tesseract.js German model. OCR output preserves page markers and remains
`applicability=document_summary`, `extraction_method=ocr`, low-confidence and
unreviewed. It is never promoted to a legal parcel rule without zone matching.
The priority selector ranks missing plan sheets first by parcels for which the
plan is already controlling and then by all candidate parcel intersections.
This makes bounded acquisition reproducible and maximizes affected parcel
coverage. The downloader applies bounded `Retry-After`/exponential backoff for
HTTP 429 responses. Text-rule SQL can be generated with `--mode=incremental`;
that replaces mentions only for the supplied assets and preserves previously
extracted plans. GRZ, GFZ, storeys, form and land-use mentions remain
low-confidence document evidence until an internal zone is spatially matched.

## Vacancy and indicative capacity screening

The capacity workflow intersects official ALKIS building polygons with parcel
polygons. It records observed footprint, an estimated floor area based on
recorded above-ground storeys, maximum observed storeys, and the share of
footprint for which storey data exists. Apparent GFZ is withheld below 80%
storey-footprint coverage. These physical observations can be compared with a
resolved legal profile, but are never stored as legal rules.

```bash
npm run derive:development-capacity -- --borough=Steglitz-Zehlendorf --locality=Lichterfelde
npm run derive:development-capacity:sql
npm run audit:development-capacity
```

A footprint overlap below 1 m² is ignored as boundary noise. “Possible vacant”
does not prove market availability or legal buildability. Indicative remaining
GRZ/GFZ also does not account for every building-envelope, setback, heritage,
tree, easement, parking, ancillary-use or authority-review constraint.

## Baunutzungsplan branch

The official ATOM download provides the 1958/60 Baunutzungsplan as an indexed
PNG in EPSG:25833. Its WMS bounding box establishes a pixel size of 1.5875 m.
The local `.pgw` and `.prj` sidecars reproduce that georeferencing.

For parcels without an imported in-force B-Plan scope:

```bash
npm run assign:bnp:coordinates
npm run assign:bnp:sample
npm run assign:bnp:sql
npm run assign:bnp:baustufe
npm run assign:bnp:baustufe:sql
```

Raster colour results enter `parcel_planning_observations`, not legal rules.
Ambiguous yellow and green classes remain combined, low-confidence candidates;
samples with insufficient thematic-pixel coverage are withheld. The dashboard
and export expose the German class label, winning-class agreement, thematic
pixel share, confidence, ambiguity flag, raster pixel locator, official source
URL and retrieval timestamp only for the `baunutzungsplan_stack_candidate`
workflow. Raster samples outside that jurisdiction branch are retained as raw
evidence but are not presented as applicable BNP land use. The official
Baustufe legend is stored separately in `planning_codebook_entries`, so GRZ,
GFZ, BMZ and storeys are resolved only after a parcel's Baustufe boundary is
established. The Baustufe extractor only accepts matching boundary colours on
both sides of the parcel centroid along both axes. It currently withholds II/2,
IV/3, V/3 and industrial class 6 because their scanned outline colours collide
with basemap ink or filled land-use colours. Accepted values remain
`baustufe_candidate` observations, not legal development-profile values. Apply
`data/seed/planning-foundations.sql` before loading these observations.
The same seed records the official continuing BO 1958 provisions and document
hash. For an accepted Baustufe, § 7 Nr. 16 supplies open/closed construction
and § 9 Nr. 5 supplies the general maximum height of four metres per full
storey. Where an unambiguous raster use is also available, § 7 Nr. 8–12
supplies a candidate permitted-use list and § 8 Nr. 1 supplies building depth
for general residential (20 m open / 13 m closed), mixed (20 m), and core
(30 m) areas. Ambiguous village/pure-residential samples are withheld from
these combined derivations. Fluchtlinien and BO 1958 exceptions remain part of
the final legal resolution.

### Fluchtlinien vectors

Berlin's underlying Fluchtlinien WFS currently exposes 17,666 vector features
with line type, f.f./A.C.O. approval kind, approval date, borough and source
update date. Import and join them to parcels with:

```bash
npm run import:fluchtlinien
npm run assign:fluchtlinien
npm run assign:fluchtlinien:sql
```

The overlay records exact intersections/touches and features within a strict
2 m tolerance separately. Parcel rows expose exact and tolerance counts, minimum
and maximum distance, relation and line-type sets, approval kinds and dates,
official feature IDs, confidence, source update date, official source URL and
retrieval timestamp. A nearby or intersecting historic line is evidence of a
potential constraint; the table does not infer a buildable polygon or claim
that the line survives without the required planning-law review. Because
Berlin describes the public georeferencing as an
informational service, exact matches are `high` confidence and tolerance-only
matches are `medium`, never officially confirmed. The result establishes the
presence and type of a planning line; it does not by itself resolve which side
is buildable or replace a district-level binding confirmation.

### FNP and §34/§35 screening context

Berlin's current FNP working map is available as an official vector WFS. Import
it and assign parcel centroids with:

```bash
npm run import:fnp
npm run assign:fnp
npm run assign:fnp:sql
npm run profiles:screen-section34-35
```

FNP categories are preparatory planning evidence, not a determination of
whether §34 or §35 BauGB applies. The screening step combines those categories
with ALKIS building-centre counts and distances. Built FNP categories with at
least 5 buildings within 50 m and 20 within 100 m produce a low-confidence
`section_34_candidate`; agricultural, forest, green or water categories with no
building within 50 m, at most 2 within 100 m and no building within 100 m
produce a low-confidence `section_35_candidate`. All other cases stay
unresolved. The FNP W1–W4 GFZ ranges and observed median storeys are displayed
as contextual candidates and never written into legal profile fields.

## Prerequisites

- Node.js `>=22.13.0`

## Detailed local setup

```bash
npm ci
npm run dev
npm run build
```

The public Lichterfelde snapshot powers the portfolio demo without external
services. Database-backed API development additionally uses the optional D1
bindings declared in `.openai/hosting.json` and simulated by `vite.config.ts`.

## Included project structure

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` contains the normalised parcel and planning-law model
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the app and run UI plus QGIS land-use contracts
- `npm run lint`: check TypeScript, React and script quality
- `npm run db:generate`: generate Drizzle migrations after schema changes
- `npm run test:data`: validate ALKIS and B-Plan normalisation
- `npm run build:bplan-raster-gis-bulk-notebook`: rebuild the restart-safe Colab notebook for sequential multi-plan OCR, clustering, reviewed georeferencing and candidate GIS export

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)

## License

No open-source licence has been selected yet. The repository can be shown as a
portfolio project, but reuse rights remain reserved until a licence is added.
