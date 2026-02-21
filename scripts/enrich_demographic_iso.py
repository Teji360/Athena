#!/usr/bin/env python3
"""Enrich cleaned demographic data with ISO3 country codes.

Input:
  data/clean/demographic_data.csv

Output:
  data/clean/demographic_data_iso.csv
"""

from __future__ import annotations

import csv
import re
from pathlib import Path

import pycountry


ROOT = Path(__file__).resolve().parents[1]
INPUT_PATH = ROOT / "data" / "clean" / "demographic_data.csv"
OUTPUT_PATH = ROOT / "data" / "clean" / "demographic_data_iso.csv"


MANUAL_NAME_TO_ISO3 = {
    "bolivia plurinational state of": "BOL",
    "congo": "COG",
    "congo democratic republic of the": "COD",
    "cote divoire": "CIV",
    "iran islamic republic of": "IRN",
    "korea democratic peoples republic of": "PRK",
    "korea republic of": "KOR",
    "lao peoples democratic republic": "LAO",
    "micronesia federated states of": "FSM",
    "moldova republic of": "MDA",
    "palestine state of": "PSE",
    "russia": "RUS",
    "russian federation": "RUS",
    "syrian arab republic": "SYR",
    "tanzania united republic of": "TZA",
    "turkiye": "TUR",
    "venezuela bolivarian republic of": "VEN",
    "viet nam": "VNM",
}


def normalize_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()


def build_name_map() -> dict[str, str]:
    name_map: dict[str, str] = {}
    for country in pycountry.countries:
        names = {getattr(country, "name", "")}
        if hasattr(country, "official_name"):
            names.add(getattr(country, "official_name"))
        if hasattr(country, "common_name"):
            names.add(getattr(country, "common_name"))
        for name in names:
            norm = normalize_name(name)
            if norm:
                name_map[norm] = country.alpha_3
    name_map.update(MANUAL_NAME_TO_ISO3)
    return name_map


def m49_to_iso3(code: str) -> str:
    if not code:
        return ""
    digits = re.sub(r"[^0-9]", "", code)
    if not digits:
        return ""
    country = pycountry.countries.get(numeric=digits.zfill(3))
    return country.alpha_3 if country else ""


def main() -> None:
    if not INPUT_PATH.exists():
        raise SystemExit(f"Input file not found: {INPUT_PATH}")

    name_map = build_name_map()
    total = 0
    mapped = 0
    kept = 0
    unmapped_names: dict[str, int] = {}

    with INPUT_PATH.open("r", encoding="utf-8", newline="") as infile:
        reader = csv.DictReader(infile)
        rows = list(reader)

    out_fields = [
        "iso3",
        "m49_code",
        "region_country_area",
        "year",
        "series",
        "value",
        "footnotes",
        "source",
    ]

    with OUTPUT_PATH.open("w", encoding="utf-8", newline="") as outfile:
        writer = csv.DictWriter(outfile, fieldnames=out_fields)
        writer.writeheader()

        for row in rows:
            total += 1
            raw_name = (row.get("region_country_area") or "").strip()
            iso3 = m49_to_iso3((row.get("m49_code") or "").strip())
            if not iso3:
                iso3 = name_map.get(normalize_name(raw_name), "")

            if iso3:
                mapped += 1
            else:
                key = raw_name or "(blank)"
                unmapped_names[key] = unmapped_names.get(key, 0) + 1

            # Strict pass: keep only rows with valid ISO3.
            if iso3:
                writer.writerow(
                    {
                        "iso3": iso3,
                        "m49_code": (row.get("m49_code") or "").strip(),
                        "region_country_area": raw_name,
                        "year": (row.get("year") or "").strip(),
                        "series": (row.get("series") or "").strip(),
                        "value": (row.get("value") or "").strip(),
                        "footnotes": (row.get("footnotes") or "").strip(),
                        "source": (row.get("source") or "").strip(),
                    }
                )
                kept += 1

    print(f"Wrote: {OUTPUT_PATH}")
    print(f"Rows mapped to ISO3: {mapped}/{total} ({(mapped / total * 100):.1f}%)")
    print(f"Rows kept in output (ISO3 only): {kept}")
    if unmapped_names:
        top = sorted(unmapped_names.items(), key=lambda x: x[1], reverse=True)[:20]
        print("Top unmapped names:")
        for name, count in top:
            print(f"  - {name}: {count}")


if __name__ == "__main__":
    main()
