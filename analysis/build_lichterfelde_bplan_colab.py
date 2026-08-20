"""Build the reader-facing Colab notebook for the Lichterfelde B-Plan demo."""

from pathlib import Path
import json
import textwrap

OUT = Path(__file__).with_name("lichterfelde-bplan-ai-demo-colab.ipynb")
nb = {
    "nbformat": 4,
    "nbformat_minor": 5,
    "metadata": {
    "colab": {"name": OUT.name, "provenance": []},
    "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
    "language_info": {"name": "python", "version": "3.x"},
    "accelerator": "GPU",
    },
    "cells": [],
}


def md(source: str):
    return {
        "cell_type": "markdown",
        "metadata": {},
        "source": textwrap.dedent(source).strip().splitlines(keepends=True),
    }


def code(source: str, tags=None):
    cell = {
        "cell_type": "code",
        "execution_count": None,
        "metadata": {},
        "outputs": [],
        "source": textwrap.dedent(source).strip().splitlines(keepends=True),
    }
    if tags:
        cell["metadata"]["tags"] = tags
    return cell


nb["cells"] = [
    md(r"""
    # Lichterfelde B-Plan AI extraction demo

    **Goal:** turn one Berlin B-Plan sheet into auditable, structured *rule candidates* that can later be assigned to ALKIS parcels through reviewed, georeferenced planning-zone polygons.

    This is a tutorial/experiment notebook, not an automated building-permission decision. It deliberately keeps three things separate:

    1. **Document extraction** — what text and symbols appear on the plan?
    2. **Spatial applicability** — which georeferenced zone does a rule govern?
    3. **Parcel assignment** — which ALKIS parcel overlaps that zone, and by how much?

    The notebook checkpoints every processed plan and retains its SHA-256 hash, page, evidence text, evidence bounding box, model name and review state. Machine output is always `unreviewed`.

    ## Goal

    Run the complete demo on a single Lichterfelde plan first. Once its output has been checked manually, switch `MAX_PLANS` to a small batch. Recommended Colab runtime: **GPU**.
    """),
    md(r"""
    ## Setup

    ### 1. Install the bounded demo environment

    `PyMuPDF` renders and reads PDFs. `transformers` runs the vision-language model. The remaining packages provide validation, tabular previews and optional spatial joins. Restart the runtime if Colab asks after installation.
    """),
    code(r"""
    %pip install -q "pymupdf>=1.24,<2" "transformers>=4.57,<5" "accelerate>=1.2,<2" \
      "bitsandbytes>=0.45,<1" "sentencepiece>=0.2,<1" "jsonschema>=4.23,<5" \
      "pandas>=2.2,<3" "pillow>=10,<13" "geopandas>=1.0,<2" "shapely>=2.0,<3"
    """, tags=["setup"]),
    md(r"""
    ### 2. Parameters

    Keep `RUN_VLM = False` for a quick ingestion/rendering check. Set it to `True` for the AI extraction. The 4B model is the conservative Colab choice; changing the model changes the experiment and must be recorded.

    Inputs can come from an uploaded ZIP or a Drive folder. A bundle may contain:

    ```text
    bplans/                         # one or more *--plan_sheet.pdf files
    reference_candidates.ndjson     # optional previous weak labels
    planning_zones.geojson          # optional reviewed/georeferenced zones
    lichterfelde-parcels.csv         # optional ALKIS parcel export
    ```
    """),
    code(r"""
    from pathlib import Path

    PROJECT_NAME = "lichterfelde-bplan-ai-demo"
    SOURCE_MODE = "upload"          # "upload" or "drive"
    DRIVE_INPUT_DIR = "/content/drive/MyDrive/lichterfelde-bplan-demo/input"
    DRIVE_OUTPUT_DIR = "/content/drive/MyDrive/lichterfelde-bplan-demo/output"

    RUN_VLM = False                 # set True after selecting a GPU runtime
    MODEL_ID = "Qwen/Qwen3-VL-4B-Instruct"
    LOAD_IN_4BIT = True
    MAX_PLANS = 1
    RENDER_DPI = 160                # raise after the first successful run if symbols are too small
    MAX_NEW_TOKENS = 1800
    RANDOM_SEED = 42

    WORK_ROOT = Path("/content/lichterfelde-bplan-demo")
    INPUT_DIR = WORK_ROOT / "input"
    OUTPUT_DIR = WORK_ROOT / "output"
    RENDER_DIR = OUTPUT_DIR / "renders"
    RESULT_DIR = OUTPUT_DIR / "results"
    for directory in (INPUT_DIR, OUTPUT_DIR, RENDER_DIR, RESULT_DIR):
        directory.mkdir(parents=True, exist_ok=True)

    print({"source_mode": SOURCE_MODE, "run_vlm": RUN_VLM, "model": MODEL_ID})
    """),
    md(r"""
    ### 3. Load the source bundle

    For upload mode, select PDFs, NDJSON/GeoJSON/CSV files, or one ZIP. For Drive mode, the notebook copies inputs into `/content` to avoid slow repeated Drive reads. Results are synced back after processing.
    """),
    code(r"""
    import shutil
    import zipfile

    if SOURCE_MODE == "drive":
        from google.colab import drive
        drive.mount("/content/drive")
        source = Path(DRIVE_INPUT_DIR)
        if not source.exists():
            raise FileNotFoundError(f"Drive input folder does not exist: {source}")
        shutil.copytree(source, INPUT_DIR, dirs_exist_ok=True)
    elif SOURCE_MODE == "upload":
        from google.colab import files
        uploaded = files.upload()
        if not uploaded:
            raise RuntimeError("No input was uploaded.")
        for name, payload in uploaded.items():
            destination = INPUT_DIR / Path(name).name
            destination.write_bytes(payload)
            if destination.suffix.lower() == ".zip":
                with zipfile.ZipFile(destination) as archive:
                    archive.extractall(INPUT_DIR)
    else:
        raise ValueError("SOURCE_MODE must be 'upload' or 'drive'.")

    pdf_paths = sorted(INPUT_DIR.rglob("*--plan_sheet.pdf")) or sorted(INPUT_DIR.rglob("*.pdf"))
    if not pdf_paths:
        raise FileNotFoundError("No PDF was found in the uploaded input.")
    print(f"Found {len(pdf_paths)} plan sheet(s).")
    for path in pdf_paths[:10]:
        print(" -", path.relative_to(INPUT_DIR))
    """),
    md(r"""
    ## Steps

    ### 4. Inventory and fingerprint every source

    File hashes prevent a corrected or replaced PDF from silently inheriting an older extraction. The manifest is the durable link between a plan key, its source file and every downstream result.
    """),
    code(r"""
    import hashlib
    import json
    import re
    from datetime import datetime, timezone

    import fitz
    import pandas as pd

    def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(chunk_size), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def plan_key_from_path(path: Path) -> str:
        return re.sub(r"--plan_sheet$", "", path.stem)

    manifest = []
    for pdf_path in pdf_paths:
        with fitz.open(pdf_path) as document:
            manifest.append({
                "planKey": plan_key_from_path(pdf_path),
                "assetType": "plan_sheet",
                "relativePath": str(pdf_path.relative_to(INPUT_DIR)),
                "contentHashSha256": sha256_file(pdf_path),
                "byteSize": pdf_path.stat().st_size,
                "pageCount": document.page_count,
                "inventoriedAt": datetime.now(timezone.utc).isoformat(),
            })

    manifest_path = OUTPUT_DIR / "source_manifest.ndjson"
    manifest_path.write_text("".join(json.dumps(row) + "\n" for row in manifest), encoding="utf-8")
    pd.DataFrame(manifest).head(10)
    """),
    md(r"""
    ### 5. Render pages and collect embedded PDF text

    Rendering produces the images seen by the VLM. Embedded text is preserved as additional evidence; it may be empty or incorrectly ordered on scanned plans.
    """),
    code(r"""
    from PIL import Image
    from IPython.display import display

    def render_plan(pdf_path: Path, dpi: int = RENDER_DPI) -> list[dict]:
        plan_key = plan_key_from_path(pdf_path)
        plan_render_dir = RENDER_DIR / plan_key
        plan_render_dir.mkdir(parents=True, exist_ok=True)
        pages = []
        with fitz.open(pdf_path) as document:
            for page_index, page in enumerate(document):
                pixmap = page.get_pixmap(dpi=dpi, alpha=False)
                image_path = plan_render_dir / f"page-{page_index + 1:03d}.jpg"
                pixmap.save(image_path)
                embedded_text = page.get_text("text").strip()
                pages.append({
                    "page": page_index + 1,
                    "imagePath": str(image_path),
                    "widthPx": pixmap.width,
                    "heightPx": pixmap.height,
                    "embeddedText": embedded_text,
                    "embeddedTextChars": len(embedded_text),
                })
        return pages

    selected_pdfs = pdf_paths[:MAX_PLANS]
    rendered = {plan_key_from_path(path): render_plan(path) for path in selected_pdfs}
    first_plan = plan_key_from_path(selected_pdfs[0])
    first_page = rendered[first_plan][0]
    print(first_plan, {key: first_page[key] for key in ("page", "widthPx", "heightPx", "embeddedTextChars")})
    preview = Image.open(first_page["imagePath"])
    preview.thumbnail((1400, 1400))
    display(preview)
    """),
    md(r"""
    ### 6. Define the extraction contract

    A rule candidate must name its evidence. The model must use `null` when the page does not establish a value and must not calculate GFZ from GRZ × storeys unless the plan explicitly states that rule.
    """),
    code(r"""
    from jsonschema import Draft202012Validator

    RULE_TYPES = [
        "land_use", "permitted_uses", "grz", "gfz", "bmz", "storeys_min",
        "storeys_max", "height_max_m", "building_form", "building_depth_m",
        "floor_area_max_sqm", "footprint_max_sqm", "roof_form", "parking",
        "landscaping", "use_restriction", "other",
    ]

    extraction_schema = {
        "type": "object",
        "required": ["planKey", "page", "summary", "candidates", "warnings"],
        "properties": {
            "planKey": {"type": "string"},
            "page": {"type": "integer", "minimum": 1},
            "summary": {"type": "string"},
            "warnings": {"type": "array", "items": {"type": "string"}},
            "candidates": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["ruleType", "textValue", "numericValue", "evidenceText", "evidenceBbox", "applicability", "confidence"],
                    "properties": {
                        "ruleType": {"enum": RULE_TYPES},
                        "textValue": {"type": ["string", "null"]},
                        "numericValue": {"type": ["number", "null"]},
                        "evidenceText": {"type": "string", "minLength": 1},
                        "evidenceBbox": {
                            "description": "[x1,y1,x2,y2] pixels in the rendered page, or null when not grounded",
                            "anyOf": [
                                {"type": "null"},
                                {"type": "array", "prefixItems": [{"type": "integer"}] * 4, "minItems": 4, "maxItems": 4},
                            ],
                        },
                        "applicability": {"enum": ["document_summary", "document_rule", "zone_rule", "unknown"]},
                        "zoneLabel": {"type": ["string", "null"]},
                        "confidence": {"enum": ["high", "medium", "low"]},
                    },
                    "additionalProperties": False,
                },
            },
        },
        "additionalProperties": False,
    }
    validator = Draft202012Validator(extraction_schema)
    print("Schema ready with", len(RULE_TYPES), "supported rule types.")
    """),
    md(r"""
    ### 7. Load the vision-language model

    This cell is intentionally gated. A quantized model lowers GPU memory demand. If 4-bit loading is unavailable on the assigned GPU, set `LOAD_IN_4BIT = False` and use a runtime with sufficient memory.
    """),
    code(r"""
    import torch

    if RUN_VLM:
        if not torch.cuda.is_available():
            raise RuntimeError("RUN_VLM=True requires a GPU runtime for this demo.")

        from transformers import AutoProcessor, AutoModelForImageTextToText, BitsAndBytesConfig

        quantization_config = None
        if LOAD_IN_4BIT:
            quantization_config = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=torch.bfloat16,
                bnb_4bit_use_double_quant=True,
            )

        processor = AutoProcessor.from_pretrained(MODEL_ID, trust_remote_code=True)
        model = AutoModelForImageTextToText.from_pretrained(
            MODEL_ID,
            device_map="auto",
            torch_dtype="auto",
            quantization_config=quantization_config,
            trust_remote_code=True,
        )
        model.eval()
        print("Loaded", MODEL_ID)
    else:
        print("VLM loading skipped. Set RUN_VLM=True to run AI extraction.")
    """, tags=["gpu"]),
    md(r"""
    ### 8. Extract auditable candidates

    The prompt treats existing embedded text as noisy supporting evidence—not truth. The output parser accepts only a JSON object and the schema validator rejects malformed records.
    """),
    code(r"""
    import random

    random.seed(RANDOM_SEED)
    torch.manual_seed(RANDOM_SEED)

    SYSTEM_PROMPT = '''You extract candidate planning rules from German Berlin B-Plan sheets.
    Return JSON only and follow the supplied schema. Never infer a legal value merely because it is common.
    Distinguish a legend/example from a rule that applies to a depicted area. Do not calculate unstated values.
    For every candidate quote the shortest legible evidence and provide its pixel bbox [x1,y1,x2,y2].
    If applicability or zone is uncertain, say unknown and lower confidence. German decimal commas are decimals.
    Machine output is for human review and is not a permit determination.'''

    def extract_json_object(text: str) -> dict:
        cleaned = text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        decoder = json.JSONDecoder()
        for start in (index for index, char in enumerate(cleaned) if char == "{"):
            try:
                value, _ = decoder.raw_decode(cleaned[start:])
                if isinstance(value, dict):
                    return value
            except json.JSONDecodeError:
                continue
        raise ValueError("No valid JSON object found in model output.")

    def run_page_extraction(plan_key: str, page_record: dict) -> tuple[dict, str]:
        image = Image.open(page_record["imagePath"]).convert("RGB")
        supporting_text = page_record["embeddedText"][:12000]
        request = (
            f"Plan key: {plan_key}\nPage: {page_record['page']}\n"
            f"Rendered size: {page_record['widthPx']} x {page_record['heightPx']} px\n"
            f"Noisy embedded PDF text:\n{supporting_text}\n\n"
            f"Required JSON Schema:\n{json.dumps(extraction_schema, ensure_ascii=False)}"
        )
        messages = [
            {"role": "system", "content": [{"type": "text", "text": SYSTEM_PROMPT}]},
            {"role": "user", "content": [{"type": "image", "image": image}, {"type": "text", "text": request}]},
        ]
        prompt = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = processor(text=[prompt], images=[image], return_tensors="pt").to(model.device)
        with torch.inference_mode():
            generated = model.generate(**inputs, max_new_tokens=MAX_NEW_TOKENS, do_sample=False)
        generated = generated[:, inputs.input_ids.shape[1]:]
        raw = processor.batch_decode(generated, skip_special_tokens=True)[0]
        parsed = extract_json_object(raw)
        errors = sorted(validator.iter_errors(parsed), key=lambda error: list(error.path))
        if errors:
            raise ValueError("Schema validation failed: " + " | ".join(error.message for error in errors[:8]))
        return parsed, raw
    """, tags=["gpu"]),
    md(r"""
    ### 9. Run once, checkpoint immediately

    Existing result files are not overwritten. This makes interrupted Colab sessions resumable and prevents accidental replacement of a reviewed experiment.
    """),
    code(r"""
    extraction_rows = []
    run_timestamp = datetime.now(timezone.utc).isoformat()

    if RUN_VLM:
        manifest_by_key = {row["planKey"]: row for row in manifest}
        for plan_key, page_records in rendered.items():
            result_path = RESULT_DIR / f"{plan_key}.json"
            if result_path.exists():
                print("Checkpoint exists, skipping", plan_key)
                continue
            page_outputs = []
            for page_record in page_records:
                parsed, raw_output = run_page_extraction(plan_key, page_record)
                page_outputs.append(parsed)
                raw_path = RESULT_DIR / f"{plan_key}--page-{page_record['page']:03d}.raw.txt"
                raw_path.write_text(raw_output, encoding="utf-8")

            result = {
                "planKey": plan_key,
                "contentHashSha256": manifest_by_key[plan_key]["contentHashSha256"],
                "model": MODEL_ID,
                "extractionVersion": "colab-qwen3-vl-demo-v1",
                "extractedAt": run_timestamp,
                "reviewStatus": "unreviewed",
                "pages": page_outputs,
            }
            result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
            extraction_rows.append(result)
            print("Saved", result_path)
    else:
        print("Dry run complete through rendering. Enable RUN_VLM for extraction.")
    """, tags=["gpu"]),
    md(r"""
    ### 10. Normalize to the dashboard candidate format

    This flattening step preserves evidence and provenance. A `zoneLabel` is only a textual hypothesis; it does **not** create a spatial zone or assign a parcel.
    """),
    code(r"""
    candidate_rows = []
    for result_path in sorted(RESULT_DIR.glob("*.json")):
        result = json.loads(result_path.read_text(encoding="utf-8"))
        for page_output in result["pages"]:
            for candidate in page_output["candidates"]:
                candidate_rows.append({
                    "planKey": result["planKey"],
                    "assetType": "plan_sheet",
                    "contentHashSha256": result["contentHashSha256"],
                    "ruleType": candidate["ruleType"],
                    "numericValue": candidate["numericValue"],
                    "textValue": candidate["textValue"],
                    "page": page_output["page"],
                    "evidenceText": candidate["evidenceText"],
                    "evidenceBbox": candidate["evidenceBbox"],
                    "zoneLabel": candidate.get("zoneLabel"),
                    "applicability": candidate["applicability"],
                    "extractionMethod": "vision_language_model",
                    "model": result["model"],
                    "extractionVersion": result["extractionVersion"],
                    "confidence": candidate["confidence"],
                    "reviewStatus": "unreviewed",
                })

    candidates_path = OUTPUT_DIR / "bplan-rule-candidates-colab.ndjson"
    candidates_path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in candidate_rows), encoding="utf-8")
    candidates_df = pd.DataFrame(candidate_rows)
    print(f"Exported {len(candidates_df)} candidate(s) to {candidates_path.name}")
    candidates_df.head(20)
    """),
    md(r"""
    ## Checks

    ### 11. Run deterministic sanity checks

    These checks do not prove legal correctness. They catch malformed bounding boxes, implausible ratios and missing provenance before human review.
    """),
    code(r"""
    def candidate_issues(row: dict, page_size: tuple[int, int]) -> list[str]:
        issues = []
        width, height = page_size
        bbox = row.get("evidenceBbox")
        if bbox is None:
            issues.append("missing_evidence_bbox")
        else:
            x1, y1, x2, y2 = bbox
            if not (0 <= x1 < x2 <= width and 0 <= y1 < y2 <= height):
                issues.append("bbox_outside_page")
        value = row.get("numericValue")
        if row["ruleType"] in {"grz", "gfz"} and value is not None and not (0 < value <= 10):
            issues.append("implausible_density_value")
        if row["ruleType"].startswith("storeys_") and value is not None and not (1 <= value <= 40):
            issues.append("implausible_storey_value")
        if not row.get("contentHashSha256") or not row.get("model"):
            issues.append("missing_provenance")
        return issues

    page_sizes = {
        (plan_key, page["page"]): (page["widthPx"], page["heightPx"])
        for plan_key, pages in rendered.items() for page in pages
    }
    qa_rows = []
    for row in candidate_rows:
        issues = candidate_issues(row, page_sizes[(row["planKey"], row["page"])])
        qa_rows.append({**row, "qaIssues": issues, "qaPass": not issues})

    qa_df = pd.DataFrame(qa_rows)
    if len(qa_df):
        display(qa_df[["planKey", "page", "ruleType", "textValue", "confidence", "qaPass", "qaIssues"]].head(50))
        print("QA pass rate:", f"{qa_df['qaPass'].mean():.1%}")
    else:
        print("No VLM candidates yet; ingestion/rendering checks passed.")
    """),
    md(r"""
    ### 12. Compare with earlier machine candidates (optional)

    Previous Lichterfelde candidates are **weak labels**, not ground truth. This comparison identifies agreements and disagreements for review; it must not be reported as accuracy.
    """),
    code(r"""
    reference_paths = sorted(INPUT_DIR.rglob("*reference*candidate*.ndjson"))
    if reference_paths and len(candidates_df):
        reference_rows = []
        for path in reference_paths:
            reference_rows.extend(json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip())
        reference_df = pd.DataFrame(reference_rows)
        comparison = candidates_df.merge(
            reference_df,
            on=["planKey", "ruleType"],
            how="outer",
            suffixes=("_new", "_weak_reference"),
            indicator=True,
        )
        display(comparison.head(50))
    else:
        print("No optional weak-reference candidate file supplied, or no new candidates yet.")
    """),
    md(r"""
    ### 13. Demonstrate the B-Plan-zone → ALKIS parcel link (optional)

    AI-extracted rules become parcel-specific only after a reviewed planning-zone geometry exists. If `planning_zones.geojson` and `lichterfelde-parcels.csv` are supplied, this cell calculates overlap ratios in metric CRS **EPSG:25833**. The ALKIS export stores parcel geometry as GeoJSON in EPSG:4326.

    A parcel crossing multiple zones retains multiple rows. Tiny sliver handling and legal precedence belong in the reviewed database workflow, not in this demo calculation.
    """),
    code(r"""
    import geopandas as gpd
    from shapely.geometry import shape

    zone_paths = sorted(INPUT_DIR.rglob("planning_zones.geojson"))
    parcel_paths = sorted(INPUT_DIR.rglob("lichterfelde-parcels.csv"))

    if zone_paths and parcel_paths:
        zones = gpd.read_file(zone_paths[0]).to_crs(25833)
        parcel_table = pd.read_csv(parcel_paths[0])
        geometry_column = next((name for name in ("geometry_geojson", "geometryGeojson", "geometry") if name in parcel_table.columns), None)
        parcel_id_column = next((name for name in ("parcel_id", "parcelId", "flurstueckskennzeichen", "parcel_key") if name in parcel_table.columns), None)
        if not geometry_column or not parcel_id_column:
            raise ValueError("Parcel CSV needs a geometry GeoJSON column and a parcel identifier column.")
        parcels = gpd.GeoDataFrame(
            parcel_table[[parcel_id_column]].copy(),
            geometry=parcel_table[geometry_column].map(lambda value: shape(json.loads(value))),
            crs=4326,
        ).to_crs(25833)
        intersections = gpd.overlay(parcels, zones, how="intersection", keep_geom_type=False)
        intersections["intersectionAreaSqm"] = intersections.geometry.area
        parcel_areas = parcels.set_index(parcel_id_column).geometry.area.rename("parcelAreaSqm")
        intersections = intersections.join(parcel_areas, on=parcel_id_column)
        intersections["parcelOverlapRatio"] = intersections["intersectionAreaSqm"] / intersections["parcelAreaSqm"]
        overlap_path = OUTPUT_DIR / "parcel-zone-overlaps.csv"
        intersections.drop(columns="geometry").to_csv(overlap_path, index=False)
        display(intersections.drop(columns="geometry").sort_values("parcelOverlapRatio", ascending=False).head(30))
    else:
        print("Spatial demo skipped: supply both planning_zones.geojson and lichterfelde-parcels.csv.")
    """),
    md(r"""
    ### 14. Package and persist the run

    The archive contains the manifest, renders, raw model output, normalized candidates and QA artifacts. Inputs are intentionally excluded to avoid duplicating large PDFs.
    """),
    code(r"""
    import platform

    run_metadata = {
        "project": PROJECT_NAME,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "model": MODEL_ID if RUN_VLM else None,
        "runVlm": RUN_VLM,
        "renderDpi": RENDER_DPI,
        "maxPlans": MAX_PLANS,
        "python": platform.python_version(),
        "sourceManifest": manifest_path.name,
        "candidateExport": candidates_path.name,
        "machineOutputIsGroundTruth": False,
    }
    (OUTPUT_DIR / "run_metadata.json").write_text(json.dumps(run_metadata, indent=2), encoding="utf-8")
    archive_path = Path(shutil.make_archive(str(WORK_ROOT / "lichterfelde-bplan-demo-results"), "zip", OUTPUT_DIR))
    print("Created", archive_path, f"({archive_path.stat().st_size / 1_000_000:.1f} MB)")

    if SOURCE_MODE == "drive":
        destination = Path(DRIVE_OUTPUT_DIR)
        destination.mkdir(parents=True, exist_ok=True)
        shutil.copy2(archive_path, destination / archive_path.name)
        print("Synced to", destination / archive_path.name)
    else:
        from google.colab import files
        files.download(str(archive_path))
    """),
    md(r"""
    ## Next Steps

    1. Inspect every evidence crop/box and correct candidates manually.
    2. Store corrections with reviewer, timestamp and source hash; do not overwrite machine output.
    3. Build a held-out gold set before changing prompts or fine-tuning.
    4. Trace and review regulatory-zone geometries separately.
    5. Import verified rules and zones into the dashboard, then run the parcel-zone intersection and precedence workflow.

    **Success criterion for this demo:** one plan produces schema-valid candidates with traceable evidence, and a reviewer can explain every accepted or rejected value. Accuracy claims require a separately reviewed ground-truth set.
    """),
]

assert nb["nbformat"] == 4 and nb["cells"]
assert all(cell["cell_type"] in {"markdown", "code"} for cell in nb["cells"])
OUT.write_text(json.dumps(nb, ensure_ascii=False, indent=1), encoding="utf-8")
print(OUT)
