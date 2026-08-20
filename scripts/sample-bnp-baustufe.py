#!/usr/bin/env python3

"""Find conservative Baustufe candidates from opposing BNP raster boundaries.

The scanned Baunutzungsplan encodes Baustufen as coloured outlines. A colour at
the parcel centroid therefore says nothing about the applicable Baustufe. This
extractor only emits a candidate when the nearest recognised outline on both
sides of a centroid agrees horizontally or vertically. The industrial class 6
is intentionally withheld because its compound orange/green outline is not
uniquely distinguishable from IV/3 and II/1 in the indexed scan.
"""

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

# Exact indexed-raster palette entries verified against the official legend.
# Classes sharing their dominant colour with filled land-use polygons are not
# included until a line-shape classifier can distinguish outline from fill.
PALETTE_TO_STAGE = {
    30: "II/1",
    13: "II/3",
    6: "III/3",
}


def parse_args():
    parser = argparse.ArgumentParser(description="Sample candidate Baustufe boundaries from the official BNP raster")
    parser.add_argument("--input", default="data/import/parcel-bnp-coordinates.ndjson")
    parser.add_argument("--raster", default="data/documents/baunutzungsplan/Baunutzungsplan.png")
    parser.add_argument("--output", default="data/import/parcel-bnp-baustufe-candidates.ndjson")
    parser.add_argument("--maximum-ray", type=int, default=900, help="Maximum search distance in pixels (1 px = 1.5875 m)")
    parser.add_argument("--limit", type=int, default=0, help="Optional row limit for QA runs")
    return parser.parse_args()


def nearest_stage(values):
    for distance, palette_index in enumerate(values, start=1):
        stage = PALETTE_TO_STAGE.get(int(palette_index))
        if stage:
            return stage, distance, int(palette_index)
    return None


def classify_point(pixels, x, y, maximum_ray):
    height, width = pixels.shape
    rays = {
        "left": pixels[y, max(0, x - maximum_ray):x][::-1],
        "right": pixels[y, x + 1:min(width, x + maximum_ray + 1)],
        "up": pixels[max(0, y - maximum_ray):y, x][::-1],
        "down": pixels[y + 1:min(height, y + maximum_ray + 1), x],
    }
    hits = {direction: nearest_stage(values) for direction, values in rays.items()}
    axes = []
    for first, second in (("left", "right"), ("up", "down")):
        if hits[first] and hits[second] and hits[first][0] == hits[second][0]:
            axes.append((hits[first][0], first, second))
    # One axis is too vulnerable to ordinary basemap lines. Require the same
    # enclosing class on both horizontal and vertical opposing pairs.
    if len(axes) != 2:
        return None, hits, "unknown"
    stages = {axis[0] for axis in axes}
    if len(stages) != 1:
        return None, hits, "unknown"
    return axes[0][0], hits, "medium"


def main():
    args = parse_args()
    image = Image.open(args.raster)
    if image.mode != "P":
        raise ValueError("Expected the official indexed PNG; refusing an altered raster")
    pixels = np.asarray(image)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    counts = {"classified": 0, "withheld": 0}
    with Path(args.input).open(encoding="utf-8") as source, output.open("w", encoding="utf-8") as destination:
        for line_number, line in enumerate(source, start=1):
            if args.limit and line_number > args.limit:
                break
            if not line.strip():
                continue
            row = json.loads(line)
            stage, hits, confidence = classify_point(pixels, row["pixelX"], row["pixelY"], args.maximum_ray)
            serialised_hits = {
                key: ({"stage": value[0], "distancePixels": value[1], "paletteIndex": value[2]} if value else None)
                for key, value in hits.items()
            }
            result = {
                **row,
                "candidateBaustufe": stage,
                "confidence": confidence,
                "boundaryHits": serialised_hits,
                "sourceLocator": f"official BNP raster, EPSG:25833 pixel {row['pixelX']},{row['pixelY']}, opposing rays <= {args.maximum_ray}px",
                "extractionMethod": "raster_opposing_boundary_candidate_v1",
                "warning": "Candidate only. II/2 is withheld because its brown outline collides with basemap ink; IV/3, V/3 and class 6 are withheld because outline and fill colours overlap in the scan.",
            }
            counts["classified" if stage else "withheld"] += 1
            destination.write(json.dumps(result, ensure_ascii=False) + "\n")
    print(json.dumps(counts, sort_keys=True))
    print(f"Wrote BNP Baustufe candidates to {output.resolve()}")


if __name__ == "__main__":
    main()
