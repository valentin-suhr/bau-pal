# Architecture

bau pal separates source evidence, spatial processing and presentation so the
interface cannot silently turn an OCR observation into a legal parcel rule.

## Runtime

1. `app/page.tsx` loads bounded GeoJSON/JSON demo assets from `public/data/`.
2. The QGIS land-use screen excludes streets, parks and public space before a
   parcel can enter vacancy or capacity screening.
3. The page derives view filters, selected-parcel results and heat-map colours.
4. The 2D SVG renderer and `components/LichterfeldeGlobe.tsx` consume the same
   parcel state. The latter warps geometry onto a Three.js sphere and extrudes
   ALKIS building footprints.
5. Purple evidence points are an independent, switchable layer. They indicate
   that both legal GRZ and GFZ fields are populated; they do not certify that
   every other planning constraint has been resolved.

## Evidence model

The D1/Drizzle schema stores source documents, plan relationships, internal
zones, extracted rules, parcel intersections, review status and resolved
development profiles separately. This allows every displayed legal value to
retain provenance and prevents document-level text from being copied to every
parcel inside a plan boundary.

## Processing lanes

- **ALKIS:** parcel and building geometry, cadastral identifiers and areas.
- **Land-use screening:** QGIS intersections with residential, street, park and
  public-space layers.
- **B-Plans:** official scopes, validity screening, document acquisition, OCR,
  reviewed georeferencing and parcel-zone intersections.
- **Outside B-Plans:** conservative routing through Baunutzungsplan,
  Fluchtlinien, FNP and §34/§35 candidate workflows.
- **Demo export:** a bounded snapshot that is fast, reproducible and safe to
  publish without the full local database.

## Quality gates

`npm test` builds the deployable app and checks the rendered feature contract as
well as parcel-level QGIS exclusion invariants. Import-specific contracts are
available through `npm run test:data` when the corresponding source extracts
are present.
