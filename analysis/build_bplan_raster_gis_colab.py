"""Build the Colab/local walkthrough for the raster B-Plan GIS pipeline."""

from pathlib import Path
import json
import textwrap

OUT = Path(__file__).with_name("bplan-raster-to-gis-colab.ipynb")
cell_number = 0


def cell_id():
    global cell_number
    cell_number += 1
    return f"cell-{cell_number:03d}"


def md(source):
    return {"cell_type": "markdown", "id": cell_id(), "metadata": {}, "source": textwrap.dedent(source).strip().splitlines(True)}


def code(source, tags=None):
    metadata = {"tags": tags} if tags else {}
    return {
        "cell_type": "code",
        "id": cell_id(),
        "execution_count": None,
        "metadata": metadata,
        "outputs": [],
        "source": textwrap.dedent(source).strip().splitlines(True),
    }


cells = [
    md("""
    # Raster B-Plan to GIS candidates

    ## Goal

    Convert one scanned Berlin B-Plan into auditable GeoPackage and shapefile candidates using open-source OCR, colour recognition, optional Segment Anything, reviewed ground-control points and deterministic QA.

    **Important:** this notebook produces extraction candidates, not an official planning statement. A reviewer must confirm georeferencing, zone boundaries and the spatial applicability of every rule.
    """),
    md("""
    ## Setup

    ### 1. Choose the runtime

    In Colab, choose **Runtime -> Change runtime type -> T4 GPU** if you will use Segment Anything. OCR and colour clustering work without a GPU. On a MacBook Air, skip the apt cell and follow the local installation block below.
    """),
    code("""
    import os, sys
    IN_COLAB = "google.colab" in sys.modules
    print({"in_colab": IN_COLAB, "python": sys.version.split()[0]})
    """),
    code("""
    if IN_COLAB:
        !apt-get update -qq
        !apt-get install -y -qq tesseract-ocr tesseract-ocr-deu gdal-bin
    """, ["setup"]),
    md("""
    ### 2. Load the pipeline folder

    For Colab, upload `bplan-raster-gis-pipeline.zip`. The bundle is generated in the project under `output/bplan-raster-gis-pipeline.zip`. Local users can set `PIPELINE_DIR` directly.
    """),
    code("""
    from pathlib import Path
    import shutil, zipfile

    if IN_COLAB:
        from google.colab import files
        uploaded = files.upload()
        bundle = next((name for name in uploaded if name.endswith(".zip")), None)
        if not bundle:
            raise RuntimeError("Upload bplan-raster-gis-pipeline.zip")
        with zipfile.ZipFile(bundle) as archive:
            archive.extractall("/content")
        PIPELINE_DIR = Path("/content/bplan-raster-gis")
    else:
        PIPELINE_DIR = Path("../pipeline/bplan-raster-gis").resolve()

    print(PIPELINE_DIR)
    """),
    code("""
    requirements = PIPELINE_DIR / ("requirements-colab.txt" if IN_COLAB else "requirements-local.txt")
    %pip install -q -r $requirements
    """, ["setup"]),
    md("""
    ## Steps

    ### 3. Upload or select the plan inputs

    Required: plan PDF and a JSON configuration. Full vectorisation also requires a GCP CSV. Optional inputs are the official plan scope, ALKIS parcels and SAM box prompts.
    """),
    code("""
    if IN_COLAB:
        from google.colab import files
        uploaded_inputs = files.upload()
        INPUT_DIR = Path("/content/bplan-input")
        INPUT_DIR.mkdir(exist_ok=True)
        for name, payload in uploaded_inputs.items():
            (INPUT_DIR / Path(name).name).write_bytes(payload)
    else:
        INPUT_DIR = PIPELINE_DIR

    sorted(path.name for path in INPUT_DIR.iterdir())[:30]
    """),
    md("""
    ### 4. Set the configuration path

    Start by copying `config.template.json`. Ensure its file paths resolve relative to the configuration file. The GCP values in the template are placeholders.
    """),
    code("""
    import json

    CONFIG_PATH = INPUT_DIR / "config.json"  # change if your file has another name
    uploaded_pdfs = sorted(INPUT_DIR.glob("*.pdf"))
    if not uploaded_pdfs:
        raise FileNotFoundError("No B-Plan PDF is present in INPUT_DIR. Run the upload cell first.")
    if len(uploaded_pdfs) > 1:
        raise RuntimeError(f"More than one PDF found; keep one for this demo: {[p.name for p in uploaded_pdfs]}")
    if not CONFIG_PATH.exists():
        template = json.loads((PIPELINE_DIR / "config.template.json").read_text())
        template["input_pdf"] = uploaded_pdfs[0].name
        template["gcps_csv"] = "gcps.csv"
        template["output_dir"] = "output"
        CONFIG_PATH.write_text(json.dumps(template, indent=2))
        print("Created a starter config for", uploaded_pdfs[0].name)
    else:
        template = json.loads(CONFIG_PATH.read_text())
        configured_pdf = CONFIG_PATH.parent / template.get("input_pdf", "")
        if not configured_pdf.exists():
            template["input_pdf"] = uploaded_pdfs[0].name
            CONFIG_PATH.write_text(json.dumps(template, indent=2))
            print("Corrected input_pdf to", uploaded_pdfs[0].name)
    print(CONFIG_PATH.read_text())
    """),
    md("""
    ### 5. Validate, render, OCR and inspect colour clusters

    The inspect stage does not create map geometry. It creates the render, OCR output and a colour-cluster preview so you can label relevant clusters before vectorisation.
    """),
    code("""
    !python $PIPELINE_DIR/bplan_pipeline.py $CONFIG_PATH --stage validate
    !python $PIPELINE_DIR/bplan_pipeline.py $CONFIG_PATH --stage inspect
    """),
    code("""
    from PIL import Image
    from IPython.display import display

    config = json.loads(CONFIG_PATH.read_text())
    output_dir = (CONFIG_PATH.parent / config.get("output_dir", "output")).resolve()
    expected_images = [output_dir / "render.png", output_dir / "cluster-preview.png"]
    missing_images = [str(path) for path in expected_images if not path.exists()]
    if missing_images:
        raise RuntimeError(
            "Inspection output is missing. Run the preceding '--stage inspect' cell and resolve "
            f"its first error before previewing. Missing: {missing_images}"
        )
    for filename in ["render.png", "cluster-preview.png"]:
        image = Image.open(output_dir / filename)
        image.thumbnail((1400, 1400))
        print(filename, image.size)
        display(image)
    """),
    md("""
    ### 6. Add reviewed spatial controls and class labels

    In QGIS, identify 6-12 matching points in the rendered image and ALKIS EPSG:25833 coordinates. Save `pixel_x,pixel_y,easting,northing` to the configured GCP CSV. Then place the relevant cluster IDs in each `segmentation.classes[*].cluster_ids` list.

    For faded or irregular regions, add box prompts to `sam-prompts.json` and set `segmentation.sam_prompts` in the config. SAM uses the box only to propose a mask; it still requires review.
    """),
    code("""
    # Small, inspectable GCP check before the full run.
    import importlib.util
    spec = importlib.util.spec_from_file_location("bplan_pipeline", PIPELINE_DIR / "bplan_pipeline.py")
    pipeline = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = pipeline
    spec.loader.exec_module(pipeline)
    config = json.loads(CONFIG_PATH.read_text())
    gcp_path = (CONFIG_PATH.parent / config["gcps_csv"]).resolve()
    transform = pipeline.fit_affine(pipeline.read_gcps(gcp_path))
    print({"rms_m": round(transform.rms_m, 3), "max_error_m": round(transform.max_error_m, 3)})
    if transform.rms_m > config.get("qa", {}).get("max_rms_m", 2.0):
        raise RuntimeError("GCP residual is too high; fix controls before vectorisation.")
    """),
    md("""
    ### 7. Vectorise and export

    This step stops on unacceptable georeferencing error. Outputs remain marked `unreviewed`.
    """),
    code("""
    !python $PIPELINE_DIR/bplan_pipeline.py $CONFIG_PATH --stage full
    """),
    md("""
    ## Checks

    ### 8. Inspect the manifest and GIS layers

    Verify RMS, feature counts, methods and hashes. Download the output and inspect all layers over ALKIS in QGIS before promoting any feature.
    """),
    code("""
    manifest = json.loads((output_dir / "manifest.json").read_text())
    print(json.dumps({
        "plan_key": manifest["plan_key"],
        "source_sha256": manifest["source_sha256"],
        "rms_m": manifest["georeferencing"]["rms_m"],
        "max_error_m": manifest["georeferencing"]["max_error_m"],
        "feature_count": manifest["feature_count"],
        "parcel_intersection_count": manifest["parcel_intersection_count"],
        "review_status": manifest["review_status"],
    }, indent=2))
    """),
    code("""
    archive = shutil.make_archive(str(output_dir), "zip", output_dir)
    print(archive)
    if IN_COLAB:
        from google.colab import files
        files.download(archive)
    """),
    md("""
    ## Next steps

    1. Review geometry over the official scope and ALKIS in QGIS.
    2. Delete false positives; split/merge zones and record the reviewer/date.
    3. Link OCR rule evidence only to the zones where it visibly applies.
    4. Promote reviewed zones to the dashboard database; keep machine candidates separate.
    5. Batch the render/OCR/cluster stages, but keep GCP and zone approval as explicit gates.
    """),
]

notebook = {
    "nbformat": 4,
    "nbformat_minor": 5,
    "metadata": {
        "colab": {"name": OUT.name, "provenance": []},
        "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
        "language_info": {"name": "python", "version": "3.x"},
        "accelerator": "GPU",
    },
    "cells": cells,
}
OUT.write_text(json.dumps(notebook, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
print(OUT)
