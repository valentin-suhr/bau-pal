#!/usr/bin/env python3

import argparse
import json
from pathlib import Path

from pypdf import PdfReader


def parse_args():
    parser = argparse.ArgumentParser(description="Extract embedded text and route scanned B-Plan PDFs to OCR")
    parser.add_argument("--input", default="data/import/bplan-assets-enriched.ndjson")
    parser.add_argument("--output", default="data/import/bplan-assets-text.ndjson")
    parser.add_argument("--text-dir", default="data/documents/bplan-text")
    parser.add_argument("--minimum-chars-per-page", type=int, default=120)
    parser.add_argument("--start", type=int, default=0, help="Zero-based input row offset for bounded batches")
    parser.add_argument("--limit", type=int, default=0, help="Optional number of input rows to process")
    return parser.parse_args()


def safe_name(value):
    return "".join(char if char.isalnum() or char in "._-" else "_" for char in str(value)).strip("_") or "asset"


def main():
    args = parse_args()
    output = Path(args.output).resolve()
    text_dir = Path(args.text_dir).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    text_dir.mkdir(parents=True, exist_ok=True)
    counts = {"complete": 0, "needs_ocr": 0, "failed": 0, "skipped": 0}

    with Path(args.input).open(encoding="utf-8") as source, output.open("w", encoding="utf-8") as destination:
        for row_index, line in enumerate(source):
            if not line.strip():
                continue
            if row_index < args.start:
                continue
            if args.limit and row_index >= args.start + args.limit:
                break
            row = json.loads(line)
            path = Path(row.get("localPath") or "")
            if row.get("retrievalStatus") != "downloaded" or row.get("mimeType") != "application/pdf" or not path.exists():
                counts["skipped"] += 1
                destination.write(json.dumps(row, ensure_ascii=False) + "\n")
                continue
            try:
                reader = PdfReader(path)
                page_text = [(page.extract_text() or "").strip() for page in reader.pages]
                text = "\n\n".join(f"--- page {index + 1} ---\n{value}" for index, value in enumerate(page_text))
                text_path = text_dir / f"{safe_name(row['planKey'])}--{row['assetType']}.txt"
                text_path.write_text(text, encoding="utf-8")
                meaningful_chars = sum(len("".join(value.split())) for value in page_text)
                threshold = max(1, len(reader.pages)) * args.minimum_chars_per_page
                needs_ocr = meaningful_chars < threshold
                row.update({
                    "pageCount": len(reader.pages),
                    "textPath": str(text_path),
                    "textCharacterCount": meaningful_chars,
                    "ocrStatus": "pending" if needs_ocr else "not_needed",
                    "extractionStatus": "pending" if needs_ocr else "machine_extracted",
                    "extractionVersion": "pypdf-embedded-text-v1",
                    "error": None,
                })
                counts["needs_ocr" if needs_ocr else "complete"] += 1
            except Exception as error:
                # A valid image-heavy PDF can exceed pypdf's decompression guard
                # or contain malformed embedded-text objects while still rendering
                # correctly. Keep it in the OCR queue; the renderer/OCR stage owns
                # the final failure decision.
                row.update({
                    "ocrStatus": "pending",
                    "extractionStatus": "pending",
                    "extractionVersion": "pypdf-embedded-text-v1-fallback-to-ocr",
                    "error": f"Embedded-text extraction failed; queued for OCR: {error}",
                })
                counts["needs_ocr"] += 1
            destination.write(json.dumps(row, ensure_ascii=False) + "\n")

    print(json.dumps(counts))
    print(f"Wrote extraction metadata to {output}")


if __name__ == "__main__":
    main()
