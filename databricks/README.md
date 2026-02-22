# Databricks Scaffold

This folder contains Angel's core data pipeline scaffolding.

## Notebooks

- `notebooks/00_setup_unity_catalog.py`
  - creates catalog/schema/volume
- `notebooks/01_ingest_hdx.py`
  - downloads HDX CSVs into volume paths and appends bronze delta tables
  - removes HDX metadata rows (`#...`)
- `notebooks/02_transform_silver.py`
  - casts/normalizes fields and joins data by ISO3
  - writes `silver_country_daily`
- `notebooks/03_score_gold.py`
  - computes weighted `risk_score`, `status` (green/yellow/red), and `recommended_actions`
  - writes `gold_country_risk_daily`
- `notebooks/05-history.sql`
  - DLT-compatible `gold_country_risk_history` materialized view (current snapshot)
  - keeps pipeline valid inside Lakeflow/DLT SQL restrictions
- `notebooks/06-history-store.sql`
  - DLT-compatible `gold_country_risk_history_store` materialized view (forecast source)
  - safe to run inside the same numbered DLT sequence

## Workflow Job

- `jobs/daily_pipeline.json`
  - Databricks Jobs API payload for a daily run
  - task chain: ingest -> silver -> gold

## First Run Checklist

1. Run `00_setup_unity_catalog.py`
2. Validate source URLs in `01_ingest_hdx.py` (replace any that change)
3. Run notebooks in order: `01` -> `02` -> `03` -> `05` -> `04` -> `06`
4. Confirm tables exist:
   - `athena_catalog.athena_schema.bronze_*`
   - `athena_catalog.athena_schema.silver_country_daily`
   - `athena_catalog.athena_schema.gold_country_risk_daily`
   - `workspace.default.gold_country_risk_history`
   - `workspace.default.gold_country_risk_history_store`
5. Create a Databricks Workflow using `jobs/daily_pipeline.json` and set the 24-hour schedule
