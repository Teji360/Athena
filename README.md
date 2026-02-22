# Project Angel

Agentic Geographic Information System for humanitarian intelligence.

## Mission

Angel unifies UN/HDX humanitarian data, computes country-level risk and funding urgency, and serves it to an interactive globe UI with clear green/yellow/red status.

## Repo Structure

- `data/`: raw and cleaned datasets
- `scripts/`: local data utilities (e.g., CSV cleanup)
- `frontend/`: Next.js app (UI + API routes), deployable on Vercel
- `databricks/`: notebook and workflow scaffolding for daily ingestion/transforms
- `docs/`: architecture and operating notes

## Quick Start

1. Run cleanup:
   - `python scripts/clean_data.py`
2. Start frontend:
   - `cd frontend && npm install && npm run dev`
3. Open:
   - `http://localhost:3000`
4. Optional env:
   - copy `frontend/.env.example` to `frontend/.env.local`

## Core Flows

- Daily ingestion from UN/HDX into Databricks tables.
- Country risk scoring with funding and humanitarian indicators.
- Next.js API routes serve geo + risk data to globe client.
- User asks natural language questions that map to filtered views.
