#!/usr/bin/env python3
"""Clean Athena CSV datasets into data/clean/.

Rules:
- remove HDX metadata rows (rows where values start with '#')
- remove fully empty rows
- trim whitespace on all fields
- normalize numeric columns for known datasets
"""

from __future__ import annotations

import csv
from decimal import Decimal, InvalidOperation
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data"
CLEAN_DIR = RAW_DIR / "clean"


NUMERIC_COLUMNS = {
    "fts_requirements_funding_global.csv": ["requirements", "funding", "percentFunded", "year"],
    "global-flood-events-fao-eve.csv": [
        "period_number",
        "cropland_flooded_sq_km",
        "cropland_flooded_ha",
        "total_area_flooded_sq_km",
        "total_area_flooded_ha",
        "perc_cropland_flooded",
        "perc_total_area_flooded",
        "pop_exposed",
    ],
    "hpc_hno_2026.csv": ["Population", "In Need", "Targeted", "Affected", "Reached"],
    "humanitarian-response-plans.csv": ["origRequirements", "revisedRequirements"],
    "cod_population_admin0.csv": ["Age_min", "Age_max", "Population", "Reference_year"],
    "global_admin_boundaries_metadata_latest.csv": [
        "admin_level_full",
        "admin_level_max",
        "admin_1_count",
        "admin_2_count",
        "admin_3_count",
        "admin_4_count",
        "admin_5_count",
    ],
}

KEEP_COLUMNS = {
    "global_admin_boundaries_metadata_latest.csv": [
        "country_name",
        "country_iso2",
        "country_iso3",
        "version",
        "admin_level_full",
        "admin_level_max",
        "admin_1_name",
        "admin_2_name",
        "admin_3_name",
        "admin_4_name",
        "admin_5_name",
        "admin_1_count",
        "admin_2_count",
        "admin_3_count",
        "admin_4_count",
        "admin_5_count",
        "date_updated",
        "date_valid_on",
        "update_frequency",
        "update_type",
        "source",
        "contributor",
    ]
}


def clean_numeric(value: str) -> str:
    value = value.strip()
    if not value:
        return ""
    normalized = value.replace(",", "")
    try:
        dec = Decimal(normalized)
    except InvalidOperation:
        return value
    if dec == dec.to_integral_value():
        return str(int(dec))
    # Keep float-like values without scientific notation when possible
    return format(dec.normalize(), "f").rstrip("0").rstrip(".")


def clean_text(value: str) -> str:
    # Collapse multiline and repeated whitespace into single spaces.
    return " ".join(value.strip().split())


def is_metadata_row(row: dict[str, str], headers: list[str]) -> bool:
    values = [str(row.get(h, "")).strip() for h in headers if str(row.get(h, "")).strip()]
    if not values:
        return False
    return sum(v.startswith("#") for v in values) / len(values) >= 0.5


def is_empty_row(row: dict[str, str], headers: list[str]) -> bool:
    return all(str(row.get(h, "")).strip() == "" for h in headers)


def clean_file(path: Path) -> tuple[int, int, int]:
    with path.open("r", encoding="utf-8-sig", newline="") as infile:
        reader = csv.DictReader(infile)
        headers = reader.fieldnames or []
        rows = list(reader)

    selected_headers = KEEP_COLUMNS.get(path.name, headers)
    cleaned_rows = []
    dropped_metadata = 0
    dropped_empty = 0
    numeric_cols = set(NUMERIC_COLUMNS.get(path.name, []))

    for row in rows:
        if is_empty_row(row, headers):
            dropped_empty += 1
            continue
        if is_metadata_row(row, headers):
            dropped_metadata += 1
            continue

        cleaned = {}
        for h in selected_headers:
            value = str(row.get(h, "")).strip()
            if h in numeric_cols:
                value = clean_numeric(value)
            else:
                value = clean_text(value)
            cleaned[h] = value
        cleaned_rows.append(cleaned)

    out_path = CLEAN_DIR / path.name
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8", newline="") as outfile:
        writer = csv.DictWriter(outfile, fieldnames=selected_headers)
        writer.writeheader()
        writer.writerows(cleaned_rows)

    return len(rows), dropped_metadata, dropped_empty


def main() -> None:
    if not RAW_DIR.exists():
        raise SystemExit(f"Data directory not found: {RAW_DIR}")

    files = sorted([p for p in RAW_DIR.glob("*.csv") if p.is_file()])
    source_dir = RAW_DIR
    if not files and CLEAN_DIR.exists():
        files = sorted([p for p in CLEAN_DIR.glob("*.csv") if p.is_file()])
        source_dir = CLEAN_DIR
    if not files:
        raise SystemExit("No CSV files found in data/")

    print(f"Cleaning {len(files)} files from {source_dir} into {CLEAN_DIR}")
    for file_path in files:
        total, metadata, empty = clean_file(file_path)
        print(
            f"- {file_path.name}: rows={total}, dropped_metadata={metadata}, "
            f"dropped_empty={empty}, kept={total - metadata - empty}"
        )


if __name__ == "__main__":
    main()
