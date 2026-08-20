#!/usr/bin/env python3
"""Auditable raster B-Plan -> GIS candidate pipeline.

The output is deliberately labelled as candidate geometry.  OCR, segmentation and
georeferencing evidence are retained so a reviewer can reproduce every feature.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import importlib
import json
import math
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


def require(module: str, install_hint: str | None = None):
    try:
        return importlib.import_module(module)
    except ImportError as error:
        hint = install_hint or f"pip install {module}"
        raise RuntimeError(f"Missing Python dependency '{module}'. Run: {hint}") from error


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def resolve_from_config(config_path: Path, value: str | None) -> Path | None:
    if not value:
        return None
    candidate = Path(value).expanduser()
    return candidate if candidate.is_absolute() else (config_path.parent / candidate).resolve()


@dataclass
class AffineTransform:
    coefficients: list[float]
    rms_m: float
    max_error_m: float
    residuals: list[dict[str, float]]

    def xy(self, pixel_x: float, pixel_y: float) -> tuple[float, float]:
        a, b, c, d, e, f = self.coefficients
        return a * pixel_x + b * pixel_y + c, d * pixel_x + e * pixel_y + f


def fit_affine(gcps: list[dict[str, float]]) -> AffineTransform:
    np = require("numpy")
    if len(gcps) < 3:
        raise ValueError("At least three GCPs are required; use 6-12 well-distributed points for QA.")
    design = np.array([[g["pixel_x"], g["pixel_y"], 1.0] for g in gcps], dtype=float)
    eastings = np.array([g["easting"] for g in gcps], dtype=float)
    northings = np.array([g["northing"] for g in gcps], dtype=float)
    east_coefficients, *_ = np.linalg.lstsq(design, eastings, rcond=None)
    north_coefficients, *_ = np.linalg.lstsq(design, northings, rcond=None)
    coefficients = [*east_coefficients.tolist(), *north_coefficients.tolist()]
    transform = AffineTransform(coefficients, 0.0, 0.0, [])
    residuals = []
    for gcp in gcps:
        predicted_e, predicted_n = transform.xy(gcp["pixel_x"], gcp["pixel_y"])
        error = math.hypot(predicted_e - gcp["easting"], predicted_n - gcp["northing"])
        residuals.append({
            **gcp,
            "predicted_easting": predicted_e,
            "predicted_northing": predicted_n,
            "error_m": error,
        })
    transform.residuals = residuals
    transform.rms_m = math.sqrt(sum(row["error_m"] ** 2 for row in residuals) / len(residuals))
    transform.max_error_m = max(row["error_m"] for row in residuals)
    return transform


def read_gcps(path: Path) -> list[dict[str, float]]:
    required = {"pixel_x", "pixel_y", "easting", "northing"}
    with path.open(newline="", encoding="utf-8-sig") as handle:
        rows = list(csv.DictReader(handle))
    if not rows or not required.issubset(rows[0]):
        raise ValueError(f"GCP CSV must contain: {', '.join(sorted(required))}")
    return [{key: float(row[key]) for key in required} for row in rows]


def render_pdf(pdf_path: Path, page_number: int, dpi: int, output_path: Path) -> None:
    fitz = require("fitz", "pip install pymupdf")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with fitz.open(pdf_path) as document:
        if not 1 <= page_number <= document.page_count:
            raise ValueError(f"Page {page_number} is outside 1..{document.page_count}")
        page = document[page_number - 1]
        pixmap = page.get_pixmap(dpi=dpi, alpha=False)
        pixmap.save(output_path)


def preprocess_for_ocr(image_path: Path, output_path: Path) -> None:
    cv2 = require("cv2", "pip install opencv-python-headless")
    image = cv2.imread(str(image_path), cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise FileNotFoundError(image_path)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(16, 16))
    enhanced = clahe.apply(image)
    threshold = cv2.adaptiveThreshold(
        enhanced, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 51, 15
    )
    cv2.imwrite(str(output_path), threshold)


def run_tesseract_ocr(image_path: Path, language: str, output_csv: Path) -> list[dict[str, Any]]:
    pytesseract = require("pytesseract")
    image_module = require("PIL.Image", "pip install pillow")
    frame = pytesseract.image_to_data(
        image_module.open(image_path),
        lang=language,
        config="--oem 1 --psm 11",
        output_type=pytesseract.Output.DATAFRAME,
    )
    frame = frame.dropna(subset=["text"])
    frame = frame[(frame["conf"] >= 0) & (frame["text"].astype(str).str.strip() != "")]
    output_csv.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(output_csv, index=False)
    return frame.to_dict(orient="records")


def run_tesseractjs_ocr(image_path: Path, output_csv: Path) -> list[dict[str, Any]]:
    """Run the project-local open-source German LSTM model through Tesseract.js."""
    pandas = require("pandas")
    node = shutil.which("node")
    bridge = Path(__file__).with_name("tesseractjs_ocr.mjs")
    if not node:
        raise RuntimeError("Node.js is required for the Tesseract.js OCR fallback.")
    if not bridge.exists():
        raise FileNotFoundError(bridge)
    tsv_path = output_csv.with_suffix(".tsv")
    subprocess.run([node, str(bridge), str(image_path), str(tsv_path)], check=True)
    columns = [
        "level", "page_num", "block_num", "par_num", "line_num", "word_num",
        "left", "top", "width", "height", "conf", "text",
    ]
    frame = pandas.read_csv(
        tsv_path,
        sep="\t",
        header=None,
        names=columns,
        quoting=csv.QUOTE_NONE,
        on_bad_lines="skip",
    )
    frame = frame.dropna(subset=["text"])
    frame = frame[(frame["conf"] >= 0) & (frame["text"].astype(str).str.strip() != "")]
    output_csv.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(output_csv, index=False)
    return frame.to_dict(orient="records")


def run_ocr(image_path: Path, language: str, output_csv: Path, engine: str) -> tuple[list[dict[str, Any]], str]:
    resolved_engine = engine
    if engine == "auto":
        resolved_engine = "native_tesseract" if shutil.which("tesseract") else "tesseractjs"
    if resolved_engine == "native_tesseract":
        return run_tesseract_ocr(image_path, language, output_csv), resolved_engine
    if resolved_engine == "tesseractjs":
        return run_tesseractjs_ocr(image_path, output_csv), resolved_engine
    raise ValueError("ocr_engine must be auto, native_tesseract or tesseractjs")


def write_cluster_preview(image_path: Path, output_dir: Path, clusters: int) -> dict[str, Any]:
    cv2 = require("cv2", "pip install opencv-python-headless")
    np = require("numpy")
    image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if image is None:
        raise FileNotFoundError(image_path)
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    pixels = lab.reshape((-1, 3)).astype(np.float32)
    random = np.random.default_rng(42)
    sample_size = min(len(pixels), 250_000)
    sample_indices = random.choice(len(pixels), size=sample_size, replace=False)
    sample = pixels[sample_indices]
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 40, 0.3)
    cv2.setRNGSeed(42)
    _compactness, _sample_labels, centers = cv2.kmeans(
        sample, clusters, None, criteria, 5, cv2.KMEANS_PP_CENTERS
    )
    flat_labels = np.empty(len(pixels), dtype=np.uint8)
    chunk_size = 500_000
    for start in range(0, len(pixels), chunk_size):
        chunk = pixels[start : start + chunk_size]
        distances = ((chunk[:, None, :] - centers[None, :, :]) ** 2).sum(axis=2)
        flat_labels[start : start + len(chunk)] = distances.argmin(axis=1).astype(np.uint8)
    labels = flat_labels.reshape(image.shape[:2])
    centers_u8 = centers.astype(np.uint8)
    reconstructed = centers_u8[labels]
    preview = cv2.cvtColor(reconstructed, cv2.COLOR_LAB2BGR)
    output_dir.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(output_dir / "cluster-preview.png"), preview)
    np.save(output_dir / "cluster-labels.npy", labels)
    stats = []
    for cluster_id, center in enumerate(centers_u8):
        rgb = cv2.cvtColor(center.reshape(1, 1, 3), cv2.COLOR_LAB2RGB)[0, 0].tolist()
        count = int((labels == cluster_id).sum())
        stats.append({"cluster_id": cluster_id, "rgb": rgb, "pixel_count": count})
    with (output_dir / "cluster-stats.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["cluster_id", "rgb", "pixel_count"])
        writer.writeheader()
        writer.writerows(stats)
    return {"clusters": clusters, "fit_sample_pixels": sample_size, "stats": stats}


def segment_clusters(labels_path: Path, class_definitions: list[dict[str, Any]]) -> dict[str, Any]:
    np = require("numpy")
    labels = np.load(labels_path)
    masks = {}
    for definition in class_definitions:
        cluster_ids = definition.get("cluster_ids", [])
        if not cluster_ids:
            continue
        masks[definition["name"]] = np.isin(labels, cluster_ids).astype("uint8")
    return masks


def segment_sam(image_path: Path, prompts_path: Path, device: str = "auto") -> dict[str, Any]:
    """Segment box prompts with the open-source Segment Anything model.

    Prompt JSON format: [{"class":"baugrenze", "box":[x1,y1,x2,y2]}, ...]
    Multiple prompts of one class are unioned into one mask.
    """
    torch = require("torch")
    transformers = require("transformers")
    np = require("numpy")
    image_module = require("PIL.Image", "pip install pillow")
    prompts = read_json(prompts_path)
    image = image_module.open(image_path).convert("RGB")
    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
    processor = transformers.SamProcessor.from_pretrained("facebook/sam-vit-base")
    model = transformers.SamModel.from_pretrained("facebook/sam-vit-base").to(device)
    masks: dict[str, Any] = {}
    for prompt in prompts:
        inputs = processor(image, input_boxes=[[prompt["box"]]], return_tensors="pt")
        inputs = {key: value.to(device) for key, value in inputs.items()}
        with torch.no_grad():
            outputs = model(**inputs)
        result = processor.image_processor.post_process_masks(
            outputs.pred_masks.cpu(), inputs["original_sizes"].cpu(), inputs["reshaped_input_sizes"].cpu()
        )[0]
        scores = outputs.iou_scores.cpu().numpy()[0, 0]
        best = int(scores.argmax())
        mask = result[0, best].numpy().astype("uint8")
        class_name = prompt["class"]
        masks[class_name] = mask if class_name not in masks else np.maximum(masks[class_name], mask)
    return masks


def pixel_polygon_to_map(coordinates: Iterable[tuple[float, float]], transform: AffineTransform):
    return [transform.xy(float(x), float(y)) for x, y in coordinates]


def vectorize_masks(
    masks: dict[str, Any],
    transform: AffineTransform,
    crs: str,
    class_definitions: list[dict[str, Any]],
):
    cv2 = require("cv2", "pip install opencv-python-headless")
    geopandas = require("geopandas")
    shapely_geometry = require("shapely.geometry", "pip install shapely")
    definition_by_name = {item["name"]: item for item in class_definitions}
    records = []
    for class_name, mask in masks.items():
        definition = definition_by_name.get(class_name, {})
        contours, _hierarchy = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            if len(contour) < 3:
                continue
            pixel_ring = [(point[0][0], point[0][1]) for point in contour]
            geometry = shapely_geometry.Polygon(pixel_polygon_to_map(pixel_ring, transform))
            if not geometry.is_valid:
                geometry = geometry.buffer(0)
            simplify_m = float(definition.get("simplify_m", 0.25))
            if simplify_m:
                geometry = geometry.simplify(simplify_m, preserve_topology=True)
            min_area_sqm = float(definition.get("min_area_sqm", 4.0))
            if geometry.is_empty or geometry.area < min_area_sqm:
                continue
            records.append({
                "zone_id": f"{class_name}-{len(records) + 1:05d}",
                "zone_class": class_name,
                "method": definition.get("method", "cluster_or_sam"),
                "confidence": definition.get("confidence", "low"),
                "review": "unreviewed",
                "area_sqm": round(geometry.area, 2),
                "geometry": geometry,
            })
    return geopandas.GeoDataFrame(records, geometry="geometry", crs=crs)


def ocr_boxes_to_geodataframe(rows: list[dict[str, Any]], transform: AffineTransform, crs: str):
    geopandas = require("geopandas")
    shapely_geometry = require("shapely.geometry", "pip install shapely")
    records = []
    for row in rows:
        left, top = float(row["left"]), float(row["top"])
        right, bottom = left + float(row["width"]), top + float(row["height"])
        ring = [(left, top), (right, top), (right, bottom), (left, bottom), (left, top)]
        records.append({
            "text": str(row["text"]),
            "ocr_conf": float(row["conf"]),
            "geometry": shapely_geometry.Polygon(pixel_polygon_to_map(ring, transform)),
        })
    return geopandas.GeoDataFrame(records, geometry="geometry", crs=crs)


RULE_PATTERNS = {
    "grz": re.compile(r"\bGRZ\s*[:=]?\s*(0[,.]\d+)\b", re.IGNORECASE),
    "gfz": re.compile(r"\bGFZ\s*[:=]?\s*(\d+[,.]\d+)\b", re.IGNORECASE),
    "bmz": re.compile(r"\bBMZ\s*[:=]?\s*(\d+[,.]\d+)\b", re.IGNORECASE),
    "storeys": re.compile(r"\b(?:Z|VG|Vollgeschosse?)\s*[:=]?\s*(I{1,4}|IV|V|VI|VII|VIII|IX|X)\b", re.IGNORECASE),
    "land_use": re.compile(r"\b(WA|WR|WB|MI|MK|GE|GI|SO|MD|MU)\b", re.IGNORECASE),
}


def extract_rule_candidates(ocr_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[int, int, int, int], list[dict[str, Any]]] = {}
    for row in ocr_rows:
        key = tuple(int(row.get(field, 0)) for field in ("page_num", "block_num", "par_num", "line_num"))
        grouped.setdefault(key, []).append(row)
    candidates = []
    for line_rows in grouped.values():
        line_rows.sort(key=lambda row: float(row.get("left", 0)))
        text = " ".join(str(row.get("text", "")).strip() for row in line_rows).strip()
        if not text:
            continue
        confidence = sum(float(row.get("conf", 0)) for row in line_rows) / len(line_rows)
        for rule_type, pattern in RULE_PATTERNS.items():
            for match in pattern.finditer(text):
                candidates.append({
                    "rule_type": rule_type,
                    "value": match.group(1).replace(",", "."),
                    "evidence_text": text,
                    "ocr_confidence": round(confidence, 2),
                    "pixel_left": int(min(float(row.get("left", 0)) for row in line_rows)),
                    "pixel_top": int(min(float(row.get("top", 0)) for row in line_rows)),
                    "review_status": "unreviewed",
                })
    return candidates


def write_georeferenced_tiff(
    image_path: Path, output_path: Path, transform: AffineTransform, crs: str
) -> None:
    rasterio = require("rasterio")
    affine_module = require("affine")
    image_module = require("PIL.Image", "pip install pillow")
    np = require("numpy")
    image = np.asarray(image_module.open(image_path).convert("RGB"))
    affine = affine_module.Affine(*transform.coefficients)
    with rasterio.open(
        output_path,
        "w",
        driver="GTiff",
        height=image.shape[0],
        width=image.shape[1],
        count=3,
        dtype=image.dtype,
        crs=crs,
        transform=affine,
        compress="JPEG",
        tiled=True,
        BIGTIFF="IF_SAFER",
    ) as dataset:
        for band in range(3):
            dataset.write(image[:, :, band], band + 1)


def write_shapefiles(zones, directory: Path) -> list[str]:
    directory.mkdir(parents=True, exist_ok=True)
    outputs = []
    for class_name in sorted(zones["zone_class"].unique()) if len(zones) else []:
        target = directory / f"{class_name}.shp"
        subset = zones[zones["zone_class"] == class_name].copy()
        subset = subset.rename(columns={"zone_class": "class", "confidence": "conf"})
        subset.to_file(target, driver="ESRI Shapefile", encoding="UTF-8")
        outputs.append(str(target))
    return outputs


def run(config_path: Path, stage: str) -> None:
    config = read_json(config_path)
    plan_key = config["plan_key"]
    pdf_path = resolve_from_config(config_path, config["input_pdf"])
    output_dir = resolve_from_config(config_path, config.get("output_dir", f"output/{plan_key}"))
    assert pdf_path and output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    render_path = output_dir / "render.png"
    ocr_image_path = output_dir / "render-ocr.png"

    render_pdf(pdf_path, int(config.get("page", 1)), int(config.get("dpi", 300)), render_path)
    preprocess_for_ocr(render_path, ocr_image_path)
    ocr_rows, resolved_ocr_engine = run_ocr(
        ocr_image_path,
        config.get("ocr_language", "deu+eng"),
        output_dir / "ocr.csv",
        config.get("ocr_engine", "auto"),
    )
    write_json(output_dir / "rule-candidates.json", extract_rule_candidates(ocr_rows))

    cluster_config = config.get("segmentation", {})
    cluster_result = write_cluster_preview(
        render_path, output_dir, int(cluster_config.get("clusters", 12))
    )
    if stage == "inspect":
        print(json.dumps({"output": str(output_dir), "cluster_preview": "cluster-preview.png"}, indent=2))
        return

    gcp_path = resolve_from_config(config_path, config.get("gcps_csv"))
    if not gcp_path or not gcp_path.exists():
        raise FileNotFoundError("The full stage requires gcps_csv. Run --stage inspect first.")
    transform = fit_affine(read_gcps(gcp_path))
    max_rms = float(config.get("qa", {}).get("max_rms_m", 2.0))
    if transform.rms_m > max_rms and not config.get("qa", {}).get("allow_high_rms", False):
        raise RuntimeError(
            f"Georeferencing RMS {transform.rms_m:.2f} m exceeds {max_rms:.2f} m; fix GCPs or explicitly allow it."
        )

    class_definitions = cluster_config.get("classes", [])
    masks = segment_clusters(output_dir / "cluster-labels.npy", class_definitions)
    sam_prompts = resolve_from_config(config_path, cluster_config.get("sam_prompts"))
    if sam_prompts and sam_prompts.exists():
        masks.update(segment_sam(render_path, sam_prompts, cluster_config.get("device", "auto")))

    crs = config.get("crs", "EPSG:25833")
    geotiff_path = output_dir / f"{plan_key}-georeferenced.tif"
    write_georeferenced_tiff(render_path, geotiff_path, transform, crs)
    zones = vectorize_masks(masks, transform, crs, class_definitions)
    official_scope_path = resolve_from_config(config_path, config.get("official_scope"))
    if official_scope_path and official_scope_path.exists() and len(zones):
        geopandas = require("geopandas")
        scope = geopandas.read_file(official_scope_path).to_crs(crs)
        zones = geopandas.clip(zones, scope)

    parcel_intersections = None
    alkis_path = resolve_from_config(config_path, config.get("alkis_parcels"))
    if alkis_path and alkis_path.exists() and len(zones):
        geopandas = require("geopandas")
        parcels = geopandas.read_file(alkis_path, layer=config.get("alkis_layer")).to_crs(crs)
        parcel_intersections = geopandas.overlay(
            parcels, zones[["zone_id", "zone_class", "geometry"]], how="intersection"
        )
        parcel_intersections["intersection_sqm"] = parcel_intersections.geometry.area.round(2)

    gpkg_path = output_dir / f"{plan_key}-candidates.gpkg"
    if gpkg_path.exists():
        gpkg_path.unlink()
    if len(zones):
        zones.to_file(gpkg_path, layer="zones", driver="GPKG")
    ocr_boxes = ocr_boxes_to_geodataframe(ocr_rows, transform, crs)
    if len(ocr_boxes):
        ocr_boxes.to_file(gpkg_path, layer="ocr_evidence", driver="GPKG")
    if parcel_intersections is not None and len(parcel_intersections):
        parcel_intersections.to_file(gpkg_path, layer="parcel_zone_intersections", driver="GPKG")
    shape_outputs = write_shapefiles(zones, output_dir / "shapefiles") if len(zones) else []

    with (output_dir / "rules.csv").open("w", newline="", encoding="utf-8") as handle:
        rules = extract_rule_candidates(ocr_rows)
        fields = list(rules[0]) if rules else ["rule_type", "value", "evidence_text", "review_status"]
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rules)

    manifest = {
        "schema": "bau-pal-raster-bplan-gis-v1",
        "plan_key": plan_key,
        "created_at": utc_now(),
        "source_pdf": str(pdf_path),
        "source_sha256": sha256_file(pdf_path),
        "page": int(config.get("page", 1)),
        "dpi": int(config.get("dpi", 300)),
        "crs": crs,
        "georeferencing": {
            "method": "affine_gcps",
            "coefficients": transform.coefficients,
            "rms_m": transform.rms_m,
            "max_error_m": transform.max_error_m,
            "residuals": transform.residuals,
        },
        "ocr": {"engine": resolved_ocr_engine, "language": "deu" if resolved_ocr_engine == "tesseractjs" else config.get("ocr_language", "deu+eng"), "tokens": len(ocr_rows)},
        "segmentation": cluster_result,
        "outputs": {"geotiff": str(geotiff_path), "gpkg": str(gpkg_path), "shapefiles": shape_outputs},
        "feature_count": int(len(zones)),
        "parcel_intersection_count": int(len(parcel_intersections)) if parcel_intersections is not None else 0,
        "review_status": "unreviewed",
        "limitations": [
            "Candidate geometries are machine-derived and require visual review against the source PDF.",
            "OCR text is evidence, not a legal interpretation or parcel-wide rule assignment.",
            "Shapefiles are convenience exports; GeoPackage is the canonical output because it preserves field names and multiple layers.",
        ],
    }
    write_json(output_dir / "manifest.json", manifest)
    print(json.dumps({"feature_count": len(zones), "rms_m": transform.rms_m, "output": str(output_dir)}, indent=2))


def validate_config(config_path: Path) -> None:
    config = read_json(config_path)
    required = ["plan_key", "input_pdf"]
    missing = [key for key in required if not config.get(key)]
    if missing:
        raise ValueError(f"Missing config fields: {', '.join(missing)}")
    print(json.dumps({"valid": True, "plan_key": config["plan_key"]}, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", type=Path)
    parser.add_argument("--stage", choices=["validate", "inspect", "full"], default="inspect")
    arguments = parser.parse_args()
    if arguments.stage == "validate":
        validate_config(arguments.config.resolve())
    else:
        run(arguments.config.resolve(), arguments.stage)


if __name__ == "__main__":
    main()
