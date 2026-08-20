"""Build the restart-safe Colab batch notebook for raster B-Plan GIS extraction."""

from pathlib import Path
import json
import textwrap

OUT = Path(__file__).with_name("bplan-raster-to-gis-bulk-colab.ipynb")
counter = 0


def cell_id():
    global counter
    counter += 1
    return f"cell-{counter:03d}"


def md(source):
    return {
        "cell_type": "markdown",
        "id": cell_id(),
        "metadata": {},
        "source": textwrap.dedent(source).strip().splitlines(True),
    }


def code(source, tags=None):
    return {
        "cell_type": "code",
        "id": cell_id(),
        "execution_count": None,
        "metadata": {"tags": tags} if tags else {},
        "outputs": [],
        "source": textwrap.dedent(source).strip().splitlines(True),
    }


cells = [
    md("""
    # Bulk raster B-Plans to reviewable GIS candidates

    ## Goal

    Run the bau pal extraction pipeline over many Berlin B-Plan PDFs in Google Colab without weakening its QA rules.

    The notebook has two explicit phases:

    1. **Batch inspection:** render, OCR and colour-cluster every plan sequentially.
    2. **Reviewed export:** georeference and vectorise only plans that have reviewed GCP files and labelled colour classes.

    Machine output remains `unreviewed`. It must not enter the dashboard as controlling planning law until a person has checked the source sheet, geometry and rule applicability.
    """),
    md("""
    ## Setup

    ### 1. Runtime and batch limits

    A standard Colab CPU runtime is enough for OCR and colour clustering. Choose a GPU only if you later enable Segment Anything. Start with 10 plans; raise the limit after checking storage and runtime.
    """),
    code("""
    import os, sys
    from pathlib import Path

    IN_COLAB = "google.colab" in sys.modules
    MAX_PLANS = 10          # 0 means every uploaded PDF
    INSPECT_DPI = 180       # 180 for batching; use 250-300 for difficult sheets
    CLUSTERS = 12
    CONTINUE_ON_ERROR = True
    USE_GOOGLE_DRIVE = True
    INSTALL_SAM = False     # optional; not needed for colour-cluster extraction

    print({"in_colab": IN_COLAB, "python": sys.version.split()[0], "max_plans": MAX_PLANS})
    """),
    code("""
    if IN_COLAB:
        !apt-get update -qq
        !apt-get install -y -qq tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng gdal-bin
    """, ["setup"]),
    md("""
    ### 2. Upload the pipeline bundle

    Upload `bplan-raster-gis-pipeline.zip` from this project. This cell is intentionally separate from the plan upload so a Colab reconnect does not mix code and source documents.
    """),
    code("""
    import shutil, zipfile

    if not IN_COLAB:
        raise RuntimeError("This bulk notebook is designed for Google Colab.")

    from google.colab import files
    uploaded = files.upload()
    bundle_name = next((name for name in uploaded if name == "bplan-raster-gis-pipeline.zip"), None)
    if not bundle_name:
        raise RuntimeError("Upload bplan-raster-gis-pipeline.zip")
    with zipfile.ZipFile(bundle_name) as archive:
        archive.extractall("/content")
    PIPELINE_DIR = Path("/content/bplan-raster-gis")
    print({"pipeline": str(PIPELINE_DIR), "files": len(list(PIPELINE_DIR.iterdir()))})
    """),
    code("""
    requirements = PIPELINE_DIR / "requirements-local.txt"
    %pip install -q -r $requirements
    if INSTALL_SAM:
        sam_requirements = PIPELINE_DIR / "requirements-colab.txt"
        %pip install -q -r $sam_requirements
    """, ["setup"]),
    md("""
    ### 3. Create persistent work folders

    Google Drive is recommended because Colab's `/content` disk disappears when the runtime resets. Checkpoints contain derived outputs, not a claim that the plans were legally verified.
    """),
    code("""
    if USE_GOOGLE_DRIVE:
        from google.colab import drive
        drive.mount("/content/drive")
        WORK_ROOT = Path("/content/drive/MyDrive/bau-pal-bplan-batch")
    else:
        WORK_ROOT = Path("/content/bau-pal-bplan-batch")

    PDF_DIR = WORK_ROOT / "pdfs"
    CONFIG_DIR = WORK_ROOT / "configs"
    OUTPUT_DIR = WORK_ROOT / "outputs"
    REVIEW_DIR = WORK_ROOT / "reviewed"
    for directory in [PDF_DIR, CONFIG_DIR, OUTPUT_DIR, REVIEW_DIR]:
        directory.mkdir(parents=True, exist_ok=True)
    print(WORK_ROOT)
    """),
    md("""
    ## Steps

    ### 4. Upload PDFs or a ZIP of PDFs

    You may upload individual plan-sheet PDFs or one ZIP. Filenames should contain the plan key, for example `I-8--plan_sheet.pdf`. Rationale PDFs should not be included in this geometry batch.
    """),
    code("""
    uploaded_plans = files.upload()
    for name, payload in uploaded_plans.items():
        destination = PDF_DIR / Path(name).name
        destination.write_bytes(payload)
        if destination.suffix.lower() == ".zip":
            with zipfile.ZipFile(destination) as archive:
                for member in archive.infolist():
                    if not member.is_dir() and member.filename.lower().endswith(".pdf"):
                        safe_name = Path(member.filename).name
                        (PDF_DIR / safe_name).write_bytes(archive.read(member))

    pdfs = sorted(PDF_DIR.glob("*.pdf"))
    if MAX_PLANS:
        pdfs = pdfs[:MAX_PLANS]
    if not pdfs:
        raise FileNotFoundError("No PDFs found. Upload plan sheets and rerun this cell.")
    print({"queued": len(pdfs), "sample": [path.name for path in pdfs[:10]]})
    """),
    md("""
    ### 5. Build one deterministic configuration per plan

    Generated configurations deliberately contain no class labels and no GCP file. The inspection phase can run immediately; the full phase cannot run accidentally.
    """),
    code("""
    import hashlib, json, re

    def plan_key_from_filename(path):
        stem = re.sub(r"--(?:plan[_-]?sheet|zeichnung).*$", "", path.stem, flags=re.I)
        return re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip("-") or path.stem

    def sha256(path):
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def config_for(pdf_path):
        plan_key = plan_key_from_filename(pdf_path)
        config_path = CONFIG_DIR / f"{plan_key}.json"
        if config_path.exists():
            return config_path
        config = json.loads((PIPELINE_DIR / "config.template.json").read_text())
        config.update({
            "plan_key": plan_key,
            "input_pdf": str(pdf_path.resolve()),
            "output_dir": str((OUTPUT_DIR / plan_key).resolve()),
            "page": 1,
            "dpi": INSPECT_DPI,
            "ocr_engine": "native_tesseract",
            "ocr_language": "deu+eng",
            "gcps_csv": str((REVIEW_DIR / f"{plan_key}.gcps.csv").resolve()),
            "official_scope": None,
            "alkis_parcels": None,
        })
        config["segmentation"]["clusters"] = CLUSTERS
        for class_definition in config["segmentation"]["classes"]:
            class_definition["cluster_ids"] = []
        config_path.write_text(json.dumps(config, indent=2, ensure_ascii=False) + "\\n")
        return config_path

    config_paths = [config_for(pdf) for pdf in pdfs]
    print({"configs": len(config_paths), "first": str(config_paths[0])})
    """),
    md("""
    ### 6. Run restart-safe batch inspection

    Plans are processed sequentially to cap memory usage. A checkpoint records the PDF hash, DPI and cluster count. A matching successful checkpoint is skipped after a reconnect; a changed PDF or configuration is processed again.
    """),
    code("""
    import gc, subprocess, time
    import pandas as pd

    summary_path = WORK_ROOT / "inspection-summary.csv"
    rows = []

    for index, config_path in enumerate(config_paths, start=1):
        config = json.loads(config_path.read_text())
        plan_key = config["plan_key"]
        pdf_path = Path(config["input_pdf"])
        output_dir = Path(config["output_dir"])
        checkpoint_path = output_dir / "inspect-checkpoint.json"
        signature = {
            "source_sha256": sha256(pdf_path),
            "dpi": config["dpi"],
            "clusters": config["segmentation"]["clusters"],
        }
        if checkpoint_path.exists():
            checkpoint = json.loads(checkpoint_path.read_text())
            if checkpoint.get("status") == "complete" and checkpoint.get("signature") == signature:
                rows.append(checkpoint["summary"])
                print(f"[{index}/{len(config_paths)}] {plan_key}: checkpoint reused")
                continue

        started = time.time()
        print(f"[{index}/{len(config_paths)}] {plan_key}: inspecting")
        try:
            completed = subprocess.run(
                [sys.executable, str(PIPELINE_DIR / "bplan_pipeline.py"), str(config_path), "--stage", "inspect"],
                text=True, capture_output=True, check=True,
            )
            ocr_path = output_dir / "ocr.csv"
            rules_path = output_dir / "rule-candidates.json"
            summary = {
                "plan_key": plan_key,
                "status": "complete",
                "seconds": round(time.time() - started, 1),
                "ocr_tokens": max(0, sum(1 for _ in ocr_path.open()) - 1) if ocr_path.exists() else 0,
                "rule_candidates": len(json.loads(rules_path.read_text())) if rules_path.exists() else 0,
                "output_dir": str(output_dir),
                "error": "",
            }
            checkpoint_path.write_text(json.dumps({"status": "complete", "signature": signature, "summary": summary}, indent=2))
        except Exception as error:
            stderr = getattr(error, "stderr", "") or ""
            summary = {
                "plan_key": plan_key,
                "status": "failed",
                "seconds": round(time.time() - started, 1),
                "ocr_tokens": 0,
                "rule_candidates": 0,
                "output_dir": str(output_dir),
                "error": (stderr or str(error))[-800:],
            }
            if not CONTINUE_ON_ERROR:
                raise
        rows.append(summary)
        pd.DataFrame(rows).to_csv(summary_path, index=False)
        gc.collect()

    inspection_summary = pd.DataFrame(rows)
    display(inspection_summary)
    print(inspection_summary["status"].value_counts().to_dict())
    """),
    md("""
    ### 7. Preview a bounded sample

    This preview is triage only. It helps identify useful cluster IDs and obvious OCR failures without flooding the notebook with every full-resolution sheet.
    """),
    code("""
    from PIL import Image
    from IPython.display import display

    completed_plans = inspection_summary.loc[inspection_summary.status == "complete", "plan_key"].tolist()
    for plan_key in completed_plans[:6]:
        print("\\n", plan_key)
        for filename in ["render.png", "cluster-preview.png"]:
            image_path = OUTPUT_DIR / plan_key / filename
            image = Image.open(image_path)
            image.thumbnail((900, 650))
            print(filename, image.size)
            display(image)
    """),
    md("""
    ### 8. Download the review pack

    The pack contains configurations, cluster statistics, previews and OCR rule candidates. Add reviewed cluster IDs to each configuration and create `<plan>.gcps.csv` files with `pixel_x,pixel_y,easting,northing` in EPSG:25833.
    """),
    code("""
    review_pack_dir = WORK_ROOT / "review-pack"
    if review_pack_dir.exists():
        shutil.rmtree(review_pack_dir)
    (review_pack_dir / "configs").mkdir(parents=True)
    (review_pack_dir / "evidence").mkdir(parents=True)

    for config_path in config_paths:
        shutil.copy2(config_path, review_pack_dir / "configs" / config_path.name)
        plan_key = json.loads(config_path.read_text())["plan_key"]
        evidence_dir = review_pack_dir / "evidence" / plan_key
        evidence_dir.mkdir(parents=True)
        for filename in ["cluster-preview.png", "cluster-stats.csv", "rule-candidates.json", "render.png"]:
            source = OUTPUT_DIR / plan_key / filename
            if source.exists():
                shutil.copy2(source, evidence_dir / filename)

    review_archive = shutil.make_archive(str(WORK_ROOT / "bplan-batch-review-pack"), "zip", review_pack_dir)
    print(review_archive)
    files.download(review_archive)
    """),
    md("""
    ## Reviewed export

    ### 9. Upload reviewed configurations and GCPs

    Upload a ZIP containing edited JSON configurations and GCP CSVs. Full processing only queues configurations with at least one labelled cluster class and an existing GCP file.
    """),
    code("""
    reviewed_upload = files.upload()
    reviewed_zip = next((name for name in reviewed_upload if name.lower().endswith(".zip")), None)
    if not reviewed_zip:
        raise RuntimeError("Upload the reviewed configuration/GCP ZIP.")
    with zipfile.ZipFile(reviewed_zip) as archive:
        archive.extractall(REVIEW_DIR)

    reviewed_configs = sorted(REVIEW_DIR.rglob("*.json"))
    reviewed_gcps = sorted(REVIEW_DIR.rglob("*.csv"))
    for reviewed_config_path in reviewed_configs:
        config = json.loads(reviewed_config_path.read_text())
        plan_key = config.get("plan_key", "")
        matching_gcps = [path for path in reviewed_gcps if path.name == f"{plan_key}.gcps.csv"]
        if matching_gcps:
            config["gcps_csv"] = str(matching_gcps[0].resolve())
            reviewed_config_path.write_text(json.dumps(config, indent=2, ensure_ascii=False) + "\\n")
    print({"reviewed_configs": len(reviewed_configs)})
    """),
    md("""
    ### 10. Validate review gates and run full export

    High RMS errors stop the plan. Failures remain in the summary and do not stop other reviewed plans when `CONTINUE_ON_ERROR` is true.
    """),
    code("""
    full_rows = []
    for index, reviewed_config_path in enumerate(reviewed_configs, start=1):
        config = json.loads(reviewed_config_path.read_text())
        plan_key = config["plan_key"]
        gcp_path = Path(config["gcps_csv"])
        labelled_classes = [item for item in config.get("segmentation", {}).get("classes", []) if item.get("cluster_ids")]
        if not gcp_path.exists() or not labelled_classes:
            full_rows.append({"plan_key": plan_key, "status": "blocked_review_gate", "features": 0, "rms_m": None, "error": "Missing GCPs or labelled cluster classes"})
            continue
        print(f"[{index}/{len(reviewed_configs)}] {plan_key}: full export")
        try:
            subprocess.run(
                [sys.executable, str(PIPELINE_DIR / "bplan_pipeline.py"), str(reviewed_config_path), "--stage", "full"],
                text=True, capture_output=True, check=True,
            )
            manifest_path = Path(config["output_dir"]) / "manifest.json"
            manifest = json.loads(manifest_path.read_text())
            full_rows.append({
                "plan_key": plan_key,
                "status": "candidate_export_complete",
                "features": manifest["feature_count"],
                "rms_m": manifest["georeferencing"]["rms_m"],
                "error": "",
            })
        except Exception as error:
            stderr = getattr(error, "stderr", "") or ""
            full_rows.append({"plan_key": plan_key, "status": "failed", "features": 0, "rms_m": None, "error": (stderr or str(error))[-800:]})
            if not CONTINUE_ON_ERROR:
                raise
        gc.collect()

    full_summary = pd.DataFrame(full_rows)
    full_summary.to_csv(WORK_ROOT / "full-export-summary.csv", index=False)
    display(full_summary)
    """),
    md("""
    ## Checks

    ### 11. Audit completed GIS candidates

    Every completed plan must have a source hash, acceptable RMS, EPSG:25833, a GeoPackage, a manifest and `unreviewed` status. This is a technical completion check, not legal approval.
    """),
    code("""
    audit_rows = []
    for row in full_rows:
        if row["status"] != "candidate_export_complete":
            continue
        plan_key = row["plan_key"]
        config_candidates = [path for path in reviewed_configs if json.loads(path.read_text()).get("plan_key") == plan_key]
        config = json.loads(config_candidates[0].read_text())
        output_dir = Path(config["output_dir"])
        manifest = json.loads((output_dir / "manifest.json").read_text())
        gpkg = output_dir / f"{plan_key}-candidates.gpkg"
        audit_rows.append({
            "plan_key": plan_key,
            "hash_present": len(manifest.get("source_sha256", "")) == 64,
            "rms_pass": manifest["georeferencing"]["rms_m"] <= config.get("qa", {}).get("max_rms_m", 2.0),
            "crs_pass": manifest.get("crs") == "EPSG:25833",
            "gpkg_present": gpkg.exists(),
            "review_status_pass": manifest.get("review_status") == "unreviewed",
            "features": manifest.get("feature_count", 0),
        })

    audit = pd.DataFrame(audit_rows)
    display(audit)
    if len(audit):
        required = ["hash_present", "rms_pass", "crs_pass", "gpkg_present", "review_status_pass"]
        if not audit[required].all(axis=None):
            raise RuntimeError("At least one candidate export failed deterministic QA.")
    """),
    code("""
    results_archive = shutil.make_archive(str(WORK_ROOT / "bplan-batch-results"), "zip", OUTPUT_DIR)
    print(results_archive)
    files.download(results_archive)
    """),
    md("""
    ## Next steps

    1. Start with ten plan sheets and inspect failure rates, runtime and Drive storage.
    2. Review candidate layers against ALKIS and official plan scopes in QGIS.
    3. Record reviewer, date and corrections; keep rejected geometry for auditability.
    4. Link OCR-derived rules only to the zones where the drawing visibly establishes them.
    5. Promote only reviewed zones and rules into the bau pal dashboard dataset.

    Colab can parallelise rendering, but sequential processing is intentional here: it is more stable, restartable and memory-safe for large scanned sheets.
    """),
]

notebook = {
    "nbformat": 4,
    "nbformat_minor": 5,
    "metadata": {
        "colab": {"name": OUT.name, "provenance": []},
        "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
        "language_info": {"name": "python", "version": "3.x"},
    },
    "cells": cells,
}

OUT.write_text(json.dumps(notebook, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
print(OUT)
