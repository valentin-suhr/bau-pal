#!/usr/bin/env python3

import csv
import gzip
import json
import math
import sys
from pathlib import Path

archive = Path(sys.argv[1] if len(sys.argv) > 1 else "data/exports/berlin-parcels.csv.gz").resolve()
output = Path("data/qa/dominant-bplan-export-audit.json").resolve()
required = {
    "parcel_id", "bplan_material_internal_land_use_zone_count",
    "bplan_dominant_zone_plan_key", "bplan_dominant_zone_key",
    "bplan_dominant_land_use_code", "bplan_dominant_zone_coverage_ratio",
    "bplan_dominant_zone_confidence", "bplan_dominant_permitted_uses_json",
    "bplan_dominant_zone_project_floor_area_cap_sqm",
    "bplan_dominant_zone_absolute_elevation_max_m_nhn",
    "bplan_dominant_zone_rule_source_locator", "bplan_dominant_zone_rule_review_status",
}
expected = {
    "11000182100511____": ("I-203", "I-203:WA", "WA", 11500.0, 52.0),
    "11000182100512____": ("I-203", "I-203:WA", "WA", 11500.0, 52.0),
    "11000101902637____": ("I-8", "I-8:public-green-space", "PUBLIC_GREEN_SPACE", None, None),
    "11000101902638____": ("I-8", "I-8:public-green-space", "PUBLIC_GREEN_SPACE", None, None),
}
mixed_expected = {"11000182100499____"}
seen = {}
violations = []
rows = dominant_rows = mixed_rows = 0

def number(value):
    if value == "":
        return None
    parsed = float(value)
    return parsed if math.isfinite(parsed) else None

with gzip.open(archive, "rt", newline="") as stream:
    reader = csv.DictReader(stream)
    missing = sorted(required - set(reader.fieldnames or []))
    if missing:
        raise SystemExit(f"Missing dominant-zone columns: {missing}")
    for row in reader:
        rows += 1
        parcel_id = row["parcel_id"]
        material_count = int(row["bplan_material_internal_land_use_zone_count"] or 0)
        code = row["bplan_dominant_land_use_code"]
        if material_count > 1:
            mixed_rows += 1
        if code:
            dominant_rows += 1
            coverage = number(row["bplan_dominant_zone_coverage_ratio"])
            if coverage is None or coverage < 0.95:
                violations.append(f"{parcel_id}: dominant coverage below 0.95")
            if material_count > 1:
                violations.append(f"{parcel_id}: dominant use assigned across multiple material land-use zones")
            if not row["bplan_dominant_zone_plan_key"] or not row["bplan_dominant_zone_key"]:
                violations.append(f"{parcel_id}: dominant use missing plan/zone key")
            if row["bplan_dominant_zone_rule_review_status"] != "manually_verified":
                violations.append(f"{parcel_id}: dominant use is not manually verified")
            if not row["bplan_dominant_zone_rule_source_locator"]:
                violations.append(f"{parcel_id}: dominant use missing source locator")
            try:
                permitted = json.loads(row["bplan_dominant_permitted_uses_json"])
                if not isinstance(permitted, list) or not permitted:
                    raise ValueError("empty/non-list")
            except (json.JSONDecodeError, ValueError):
                violations.append(f"{parcel_id}: invalid dominant permitted-use JSON")
            for field in ("bplan_dominant_zone_project_floor_area_cap_sqm", "bplan_dominant_zone_absolute_elevation_max_m_nhn"):
                value = number(row[field])
                if value is not None and value <= 0:
                    violations.append(f"{parcel_id}: non-positive {field}")
        elif any(row[field] for field in required if field not in {"parcel_id", "bplan_material_internal_land_use_zone_count"}):
            violations.append(f"{parcel_id}: partial dominant-zone fields without land-use code")
        if parcel_id in expected or parcel_id in mixed_expected:
            seen[parcel_id] = row

for parcel_id, (plan_key, zone_key, code, floor_cap, elevation) in expected.items():
    row = seen.get(parcel_id)
    if not row:
        violations.append(f"{parcel_id}: expected production proof row missing")
        continue
    actual = (row["bplan_dominant_zone_plan_key"], row["bplan_dominant_zone_key"], row["bplan_dominant_land_use_code"])
    if actual != (plan_key, zone_key, code):
        violations.append(f"{parcel_id}: expected {(plan_key, zone_key, code)}, got {actual}")
    if number(row["bplan_dominant_zone_project_floor_area_cap_sqm"]) != floor_cap:
        violations.append(f"{parcel_id}: unexpected project floor-area cap")
    if number(row["bplan_dominant_zone_absolute_elevation_max_m_nhn"]) != elevation:
        violations.append(f"{parcel_id}: unexpected absolute elevation")
    if plan_key == "I-203" and (row["legal_gfz"] or row["legal_height_max_m"]):
        violations.append(f"{parcel_id}: absolute cap leaked into parcel GFZ or relative height")

for parcel_id in mixed_expected:
    row = seen.get(parcel_id)
    if not row or row["bplan_dominant_land_use_code"] or int(row["bplan_material_internal_land_use_zone_count"] or 0) < 2:
        violations.append(f"{parcel_id}: mixed-zone proof row was incorrectly flattened")

report = {
    "archive": str(archive), "rows": rows, "dominantRows": dominant_rows,
    "mixedRows": mixed_rows, "violations": violations,
    "checks": {
        "allRowsScanned": rows == 403484, "dominantRowsExist": dominant_rows > 0,
        "mixedRowsExist": mixed_rows > 0, "dominantSemanticsValid": not violations,
    },
}
report["pass"] = all(report["checks"].values())
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report, indent=2))
if not report["pass"]:
    raise SystemExit(1)
