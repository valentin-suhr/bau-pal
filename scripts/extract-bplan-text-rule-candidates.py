#!/usr/bin/env python3

import argparse
import glob
import json
import re
from pathlib import Path


ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8, "IX": 9, "X": 10, "XI": 11, "XII": 12, "XIII": 13, "XIV": 14, "XV": 15, "XVI": 16, "XVII": 17, "XVIII": 18, "XIX": 19, "XX": 20}
PATTERNS = [
    ("grz", re.compile(r"\b(?:Grundflächenzahl|GRZ)\s*(?:(?:von|=|:)\s*)?([01][,.][0-9]+)", re.I)),
    ("gfz", re.compile(r"\b(?:Geschossflächenzahl|GFZ)\s*(?:(?:von|=|:)\s*)?([0-9]{1,2}[,.][0-9]+)", re.I)),
    ("storeys_max", re.compile(r"\b([IVX]{1,5})\s+Vollgeschossen?\b", re.I)),
    ("building_form", re.compile(r"\b(geschlossene|offene)\s+Bauweise\s+(?:festgesetzt|zulässig)\b", re.I)),
    ("land_use", re.compile(r"\b(?:wird|werden)\s+als\s+Art\s+der\s+Nutzung\s+(allgemeines Wohngebiet|reines Wohngebiet|besonderes Wohngebiet|Mischgebiet|urbanes Gebiet|Kerngebiet|Gewerbegebiet|Industriegebiet|Dorfgebiet|Sondergebiet)\b", re.I)),
    ("other", re.compile(r"\bZulässig\s+sind\s*:", re.I)),
]


def args():
    parser = argparse.ArgumentParser(description="Extract reviewable B-Plan text mentions, not parcel rules")
    parser.add_argument("--inputs", default="data/import/bplan-assets-batch200-text-[0-9]*.ndjson")
    parser.add_argument("--output", default="data/import/bplan-text-rule-candidates.ndjson")
    return parser.parse_args()


def compact(value):
    return re.sub(r"\s+", " ", value).strip()


def main():
    options = args()
    assets = {}
    filenames = []
    for input_pattern in options.inputs.split(","):
        filenames.extend(glob.glob(input_pattern.strip()))
    for filename in filenames:
        for line in Path(filename).open(encoding="utf-8"):
            if line.strip():
                row = json.loads(line)
                assets[row["url"]] = row
    output = Path(options.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    counts = {}
    with output.open("w", encoding="utf-8") as destination:
        for asset in assets.values():
            text_path = Path(asset.get("textPath") or "")
            if asset.get("extractionStatus") != "machine_extracted" or not text_path.exists():
                continue
            text = text_path.read_text(encoding="utf-8", errors="replace")
            for rule_type, pattern in PATTERNS:
                for match in pattern.finditer(text):
                    before = text[max(0, match.start() - 220):match.start()]
                    after_length = 650 if rule_type == "other" else 260
                    after = text[match.end():min(len(text), match.end() + after_length)]
                    context = compact(before + match.group(0) + after)
                    if rule_type == "storeys_max":
                        if not re.search(r"festgesetzt|zwingend|zulässig|Gebäudeteil", context, re.I):
                            continue
                        numeric = ROMAN.get(match.group(1).upper())
                        text_value = match.group(0)
                    elif rule_type in ("grz", "gfz"):
                        numeric = float(match.group(1).replace(",", "."))
                        text_value = match.group(0)
                    elif rule_type == "building_form":
                        numeric = None
                        text_value = "closed" if match.group(1).lower().startswith("gesch") else "open"
                    elif rule_type == "land_use":
                        numeric = None
                        text_value = compact(match.group(1))
                    else:
                        numeric = None
                        text_value = compact(text[match.start():min(len(text), match.end() + 520)])
                    page = text[:match.start()].count("--- page ") or 1
                    destination.write(json.dumps({
                        "planKey": asset["planKey"], "assetType": asset["assetType"],
                        "assetUrl": asset["url"], "contentHashSha256": asset.get("contentHashSha256"),
                        "ruleType": rule_type, "numericValue": numeric, "textValue": text_value,
                        "page": page, "characterOffset": match.start(), "context": context,
                        "applicability": "document_summary",
                        "extractionMethod": "ocr" if str(asset.get("extractionVersion", "")).startswith("tesseract") else "embedded_text_mention",
                        "confidence": "low", "reviewStatus": "unreviewed",
                        "interpretation": "Machine-readable document mention only; it may describe a subarea, exception, auxiliary coverage, rationale scenario, legend, or OCR error. It is not a parcel-specific rule.",
                    }, ensure_ascii=False) + "\n")
                    counts[rule_type] = counts.get(rule_type, 0) + 1
    print(json.dumps({"assets": len(assets), "mentions": counts}, ensure_ascii=False, sort_keys=True))
    print(f"Wrote text-rule candidates to {output.resolve()}")


if __name__ == "__main__":
    main()
