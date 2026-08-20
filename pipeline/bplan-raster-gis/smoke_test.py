#!/usr/bin/env python3
"""Dependency-light checks for the transform and OCR rule grouping."""

import math

from bplan_pipeline import extract_rule_candidates, fit_affine


gcps = []
for pixel_x, pixel_y in [(0, 0), (1000, 0), (0, 1000), (1000, 1000), (500, 250)]:
    gcps.append(
        {
            "pixel_x": pixel_x,
            "pixel_y": pixel_y,
            "easting": 0.25 * pixel_x + 0.01 * pixel_y + 388000,
            "northing": -0.02 * pixel_x - 0.25 * pixel_y + 5811000,
        }
    )

transform = fit_affine(gcps)
assert transform.rms_m < 1e-4, transform.rms_m
easting, northing = transform.xy(400, 600)
assert math.isclose(easting, 388106.0, abs_tol=1e-6)
assert math.isclose(northing, 5810842.0, abs_tol=1e-6)

ocr_rows = [
    {"page_num": 1, "block_num": 1, "par_num": 1, "line_num": 1, "left": 10, "top": 20, "text": "GRZ", "conf": 95},
    {"page_num": 1, "block_num": 1, "par_num": 1, "line_num": 1, "left": 50, "top": 20, "text": "0,30", "conf": 91},
    {"page_num": 1, "block_num": 1, "par_num": 1, "line_num": 2, "left": 10, "top": 50, "text": "WA", "conf": 88},
]
rules = extract_rule_candidates(ocr_rows)
assert any(rule["rule_type"] == "grz" and rule["value"] == "0.30" for rule in rules)
assert any(rule["rule_type"] == "land_use" and rule["value"].upper() == "WA" for rule in rules)

print({"affine_rms_m": transform.rms_m, "rule_candidates": len(rules), "status": "passed"})
