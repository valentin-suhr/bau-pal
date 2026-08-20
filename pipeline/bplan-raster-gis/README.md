# Raster B-Plan to GIS candidate pipeline

This pipeline turns a scanned Berlin B-Plan into **reviewable GIS candidates**. It runs on an Apple-silicon Mac or a Google Colab GPU. The canonical output is a GeoPackage; one shapefile is also written for each detected class.

It does not claim that an automatically traced polygon is legally authoritative. Every result keeps its PDF hash, page, OCR evidence, georeferencing residuals, extraction method, confidence and review state.

## What it produces

- `render.png`: source page at a controlled DPI
- `ocr.csv`: word boxes and OCR confidence
- `rule-candidates.json` and `rules.csv`: GRZ/GFZ/BMZ/storey/use candidates with evidence
- `cluster-preview.png` and `cluster-stats.csv`: colour clusters for human labelling
- `<plan>-georeferenced.tif`: georeferenced source raster for QGIS comparison
- `<plan>-candidates.gpkg`:
  - `zones`: traced planning zones
  - `ocr_evidence`: georeferenced OCR boxes
  - `parcel_zone_intersections`: optional intersections with ALKIS parcels
- `shapefiles/<class>.*`: convenience exports by zone class
- `manifest.json`: complete provenance and QA metrics

## Pipeline

1. **Render and fingerprint** the PDF at 300 DPI.
2. **OCR** with Tesseract's open-source LSTM model. The local setup automatically uses the bundled German Tesseract.js model when no native Tesseract executable is installed; a native installation can use `deu+eng`.
3. **Recognise image regions** in two complementary ways:
   - LAB colour clustering for repeated plan colours and fills.
   - Segment Anything (`facebook/sam-vit-base`) for reviewer-provided boxes around irregular zones.
4. **Georeference** pixels using 6-12 control points copied from QGIS/ALKIS. The run stops when RMS error exceeds 2 m unless explicitly overridden.
5. **Vectorise and clean** masks, clip them to Berlin's official B-Plan scope, and optionally intersect them with ALKIS parcels.
6. **Export and review** in QGIS. Only reviewed features should be promoted into the dashboard's controlling-rule table.

The colour-cluster and SAM routes are proposals, not competitors. Colour clustering is fast and reproducible; SAM is useful when a zone is visually coherent but its colour is faded or shared with other symbols.

## Local setup: Apple-silicon MacBook Air

Recommended: 16 GB RAM or more. The base pipeline is CPU-friendly. Use SAM only for selected difficult zones; it uses Apple's MPS backend when available.
Use Python 3.11 or 3.12.

```bash
brew install tesseract tesseract-lang
cd pipeline/bplan-raster-gis
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements-local.txt
```

Homebrew is optional in this repository: leave `ocr_engine` set to `auto` and the pipeline uses the project-local German Tesseract.js model when the native executable is absent.

For optional SAM image segmentation:

```bash
python -m pip install -r requirements-colab.txt
```

Copy `config.template.json` to a plan-specific configuration. Replace the example GCP values; they are placeholders and must never be used as real controls.

```bash
cp config.template.json config.6-9B.json
python bplan_pipeline.py config.6-9B.json --stage validate
python bplan_pipeline.py config.6-9B.json --stage inspect
```

Open `cluster-preview.png`, `cluster-stats.csv` and `render.png`. Put the selected cluster numbers into `segmentation.classes[*].cluster_ids`. In QGIS, record 6-12 well-distributed matching points as `pixel_x,pixel_y,easting,northing` in EPSG:25833. Then run:

```bash
python bplan_pipeline.py config.6-9B.json --stage full
```

## Colab setup

Open `analysis/bplan-raster-to-gis-colab.ipynb`, select a GPU runtime if using SAM, and run it from top to bottom. Upload the pipeline bundle plus the plan PDF, GCP CSV, config and optional official-scope/ALKIS files. Colab installs Tesseract, the German language model and all Python packages.

## Choosing GCPs

- Use road intersections, parcel corners, railway crossings or other stable points visible in both the scan and ALKIS.
- Spread points across the full sheet; do not place them along one street.
- Do not use the printed frame unless its coordinate system is known.
- Start with 8 points and reserve 2 as independent check points when possible.
- Target RMS <= 1 m; the default hard stop is 2 m.

The current implementation uses an affine transform, suitable for most flat scanned plan sheets. If residuals show spatially patterned distortion, re-scan or add a reviewed thin-plate-spline/GDAL georeferencing step rather than accepting a high RMS.

## Suggested batch policy

- Run OCR and cluster previews for many plans unattended.
- Stop before full vectorisation when GCPs or class labels are missing.
- Prioritise plans that control vacant or underbuilt parcels.
- Promote only reviewed zones. Keep `unreviewed` candidates in a separate layer.
- Re-run only when the source PDF hash or extraction configuration changes.

## Limits

- OCR cannot determine which spatial sub-zone a rule applies to without a reviewed link.
- SAM recognises visual regions, not planning law.
- Line symbols such as building lines, boundaries and easements often need dedicated line extraction or manual tracing.
- Shapefile truncates field names and does not support multiple layers. GeoPackage is the authoritative pipeline output.
