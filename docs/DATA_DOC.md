# Athena DataDoc

This document defines what each data layer analyzes and how it should render on the globe map.

## 1) Current Cleaned Data Inventory

- `data/clean/fts_requirements_funding_global.csv`
  - Goal: financial coverage and funding gap signal
  - Grain: appeal/plan records by country and year
  - Key field: `countryCode` (ISO3)
- `data/clean/humanitarian-response-plans.csv`
  - Goal: response plan pressure and revised funding requirement signal
  - Grain: response plan records; country appears in `locations` (pipe-delimited)
  - Key field: `locations` -> split to ISO3
- `data/clean/hpc_hno_2026.csv`
  - Goal: humanitarian need and targeting pressure signal
  - Grain: country + cluster + description
  - Key field: `Country ISO3`
- `data/clean/global-flood-events-fao-eve.csv`
  - Goal: hazard/exposure signal (flood impact)
  - Grain: admin event periods (country + admin area + period window)
  - Key field: `adm0_iso3`
- `data/clean/global_admin_boundaries_metadata_latest.csv`
  - Goal: boundary metadata quality/confidence layer
  - Grain: country metadata
  - Key field: `country_iso3`

## 2) Layer Model (What Each Layer Analyzes)

### Layer A: Financial Stress Layer

- Sources:
  - `fts_requirements_funding_global.csv`
  - `humanitarian-response-plans.csv`
- Analysis:
  - requirement vs received funding
  - percent funded
  - revised requirements pressure
- Primary metrics:
  - `funding_gap_ratio = (requirements - funding) / requirements`
  - `percentFunded`
  - `revisedRequirements` (aggregated by ISO3)
- Map rendering:
  - country fill intensity based on `funding_gap_ratio`
  - tooltip: required, funded, gap, % funded

### Layer B: Humanitarian Need Layer

- Source: `hpc_hno_2026.csv`
- Analysis:
  - population in need and targeted coverage by country
  - cluster-level stress detail on demand
- Primary metrics:
  - `in_need`
  - `targeted`
  - `targeted_ratio = targeted / in_need`
- Map rendering:
  - country fill by `in_need` normalized to global range
  - click panel: cluster breakdown (Food, Health, WASH, etc.)

### Layer C: Hazard Exposure Layer (Flood)

- Source: `global-flood-events-fao-eve.csv`
- Analysis:
  - flood event exposure and affected area pressure
  - recent-period hazard intensity
- Primary metrics:
  - `flood_pop_exposed = SUM(pop_exposed) by ISO3`
  - `flood_area_pct = AVG(perc_total_area_flooded) by ISO3`
  - `recent_event_count` by ISO3 (optional derived metric)
- Map rendering:
  - optional overlay (heat or hatch) over country color
  - tooltip: exposed population, area flooded %, period coverage

### Layer D: Boundary Confidence Layer

- Source: `global_admin_boundaries_metadata_latest.csv`
- Analysis:
  - data confidence context for each country boundary source
  - staleness and update signals
- Primary metrics:
  - `date_updated`
  - `update_type`, `update_frequency`
  - `admin_level_max`
- Map rendering:
  - subtle badge/flag in side panel (not primary color layer)
  - warning if boundary metadata is old or caveat-heavy

### Layer E: Composite Crisis Layer (Primary Globe Layer)

- Sources:
  - Financial Stress + Humanitarian Need + Hazard Exposure
- Analysis:
  - combined country risk for operational prioritization
  - core map status used by Athena
- Primary metrics:
  - `risk_score` (0 to 1)
  - `status` in `green`, `yellow`, `red`
  - `recommended_actions`
- Map rendering:
  - base country fill color:
    - `green` = safe/stable
    - `yellow` = worrisome/monitor
    - `red` = crisis/immediate action
  - click panel: component breakdown and recommendation

## 3) Join Strategy and Canonical Keys

- Canonical geographic key: `ISO3` (uppercase, 3 letters)
- Standard mappings:
  - `countryCode` -> `iso3`
  - `Country ISO3` -> `iso3`
  - `adm0_iso3` -> `iso3`
  - `country_iso3` -> `iso3`
  - `locations` (split by `|`) -> `iso3`
- Temporal handling:
  - core dashboard defaults to latest available date/year
  - allow historical filter by `as_of_date`

## 4) Databricks Layered Outputs (for Map/API)

- Bronze:
  - raw + lightly sanitized source tables
- Silver:
  - `silver_country_daily` with normalized per-country features
- Gold:
  - `gold_country_risk_daily` with final map-ready outputs:
    - `iso3`
    - `as_of_date`
    - `risk_score`
    - `status`
    - component metrics
    - `recommended_actions`

## 5) Rendering Contract for Frontend

- Required fields per country feature:
  - `iso3`
  - `status`
  - `risk_score`
  - `funding_gap_ratio`
  - `in_need`
  - `flood_pop_exposed`
  - `recommended_actions`
- Interaction model:
  - hover: high-level summary
  - click: detailed panel
  - query mode: filter by status/category (e.g., "where are wars happening?")

## 6) Known Gaps and Next Data Additions

- Conflict/war-specific source is not yet present in cleaned files.
  - Add conflict event feed (for direct warfare signal).
- Population baseline file is not in current `data/clean` set.
  - Re-introduce cleaned population baseline for stronger normalization.
- Some datasets have sparse optional fields (`Affected`, `Reached`).
  - Keep nullable and down-weight in scoring until quality improves.

## 7) Recommended First Production Slice

1. Ship Composite Crisis Layer using funding + HNO + flood.
2. Keep Boundary Confidence Layer as side-panel context only.
3. Add conflict source as next increment and rebalance weights.
4. Version scoring logic (`v1`, `v2`, etc.) for auditability.
