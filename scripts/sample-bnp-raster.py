#!/usr/bin/env python3

import argparse
import json
from collections import Counter
from pathlib import Path

from PIL import Image

Image.MAX_IMAGE_PIXELS = None

# Representative palette colours sampled from the official map legend. The
# source is a scanned cartographic raster, so classifications are candidates.
CLASSES = {
    "village_or_pure_residential": ((246, 230, 32), "Dorfgebiet oder reines Wohngebiet", "low"),
    "general_residential": ((213, 170, 107), "allgemeines Wohngebiet", "medium"),
    "mixed": ((233, 141, 137), "gemischtes Gebiet", "medium"),
    "restricted_work": ((190, 187, 181), "beschränktes Arbeitsgebiet", "medium"),
    "pure_work": ((133, 137, 133), "reines Arbeitsgebiet", "medium"),
    "core": ((88, 77, 71), "Kerngebiet", "medium"),
    "land_reserve": ((215, 240, 198), "Baulandreserve", "medium"),
    "special_purpose": ((234, 124, 70), "besondere Zweckbestimmung", "medium"),
    "non_build_or_forest": ((89, 126, 54), "Nichtbaugebiet oder Waldgebiet", "low"),
}

# The official download is an indexed PNG. Restrict sampling to palette entries
# actually used in the legend swatches; nearest-colour matching also captures
# basemap ink and materially overstates Kerngebiet/Baulandreserve.
PALETTE_CLASS_INDEXES = {
    "village_or_pure_residential": {39, 40, 41},
    "general_residential": {44, 45, 46, 47},
    "mixed": {4, 60, 61, 62},
    "restricted_work": {43, 48},
    "pure_work": {23},
    "core": {50, 51, 52, 54, 57, 59},
    "land_reserve": {28, 36, 37, 38},
    "special_purpose": {53, 55, 56},
    "non_build_or_forest": {24, 25, 26, 27, 29, 31, 32, 33, 35},
}


def parse_args():
    parser = argparse.ArgumentParser(description="Sample candidate land use from the official BNP raster")
    parser.add_argument("--input", default="data/import/parcel-bnp-coordinates.ndjson")
    parser.add_argument("--raster", default="data/documents/baunutzungsplan/Baunutzungsplan.png")
    parser.add_argument("--output", default="data/import/parcel-bnp-candidates.ndjson")
    parser.add_argument("--radius", type=int, default=10)
    parser.add_argument("--maximum-colour-distance", type=float, default=58.0)
    return parser.parse_args()


def distance(left, right):
    return sum((a - b) ** 2 for a, b in zip(left, right)) ** 0.5


def classify(rgb, maximum):
    key, (_, label, confidence) = min(CLASSES.items(), key=lambda item: distance(rgb, item[1][0]))
    separation = distance(rgb, CLASSES[key][0])
    return (key, label, confidence, separation) if separation <= maximum else None


def main():
    args = parse_args()
    image = Image.open(args.raster)
    if image.mode != "P":
        image = image.convert("P", palette=Image.Palette.ADAPTIVE, colors=256)
    palette = image.getpalette()
    palette_classes = {}
    for class_key, indexes in PALETTE_CLASS_INDEXES.items():
        _, label, confidence = CLASSES[class_key]
        for index in indexes:
            rgb = tuple(palette[index * 3:index * 3 + 3])
            palette_classes[index] = (class_key, label, confidence, distance(rgb, CLASSES[class_key][0]))
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    counts = Counter()
    with Path(args.input).open(encoding="utf-8") as source, output.open("w", encoding="utf-8") as destination:
        for line in source:
            if not line.strip():
                continue
            row = json.loads(line)
            x, y = row["pixelX"], row["pixelY"]
            box = (
                max(0, x - args.radius), max(0, y - args.radius),
                min(image.width, x + args.radius + 1), min(image.height, y + args.radius + 1),
            )
            pixel_counts = Counter(image.crop(box).get_flattened_data())
            class_counts = Counter()
            class_distances = Counter()
            class_values = {}
            for palette_index, frequency in pixel_counts.items():
                value = palette_classes.get(palette_index)
                if not value:
                    continue
                class_counts[value[0]] += frequency
                class_distances[value[0]] += value[3] * frequency
                class_values[value[0]] = value
            sample_pixels = sum(pixel_counts.values())
            classified_pixels = class_counts.total()
            sample_coverage = classified_pixels / sample_pixels
            if not class_counts or sample_coverage < 0.35:
                counts["unclassified"] += 1
                result = {**row, "candidateLandUseCode": None, "candidateLandUse": None,
                          "confidence": "unknown", "sampleAgreement": 0,
                          "classifiedPixelShare": sample_coverage, "colourDistance": None}
            else:
                winner, frequency = class_counts.most_common(1)[0]
                _, label, confidence, _ = class_values[winner]
                agreement = frequency / class_counts.total()
                if agreement < 0.55:
                    confidence = "low"
                result = {
                    **row, "candidateLandUseCode": winner, "candidateLandUse": label,
                    "confidence": confidence, "sampleAgreement": agreement,
                    "classifiedPixelShare": sample_coverage,
                    "colourDistance": class_distances[winner] / frequency,
                    "sourceLocator": f"official BNP raster, EPSG:25833 pixel {x},{y}, radius {args.radius}",
                    "extractionMethod": "raster_colour_candidate_v1",
                }
                counts[winner] += 1
            destination.write(json.dumps(result, ensure_ascii=False) + "\n")
    print(json.dumps(counts, ensure_ascii=False, sort_keys=True))
    print(f"Wrote BNP candidates to {output.resolve()}")


if __name__ == "__main__":
    main()
