# Databricks Scaffold

This folder holds starter assets for Athena data workflows.

## Suggested assets

- `notebooks/01_ingest_hdx.py`: pull HDX datasets into bronze tables
- `notebooks/02_transform_silver.py`: normalize and join on ISO3
- `notebooks/03_score_gold.py`: compute country risk and status
- `jobs/daily_pipeline.json`: workflow definition for 24-hour execution

Use this as source-controlled reference while actual jobs run in Databricks Workflows.
