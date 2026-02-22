# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Frontend (Next.js)
```bash
cd frontend
npm install
npm run dev      # Dev server at localhost:3000
npm run build    # Production build
npm run lint     # ESLint
```

### Data Processing
```bash
python scripts/clean_data.py   # Clean raw CSVs → data/clean/
```

## Environment Variables

Create `frontend/.env.local` with:
- `NEXT_PUBLIC_MAPBOX_TOKEN` — Mapbox access token
- `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` — ElevenLabs TTS
- `DATABRICKS_HOST`, `DATABRICKS_TOKEN`, `DATABRICKS_WAREHOUSE_ID` — Databricks SQL
- `DATABRICKS_RISK_TABLE` — defaults to `workspace.default.gold_country_risk_serving`

## Architecture

**Athena** is a humanitarian crisis monitoring system combining a Databricks data pipeline with a Next.js frontend.

### Data Pipeline (Medallion Architecture)
Located in `databricks/notebooks/`:
- **Bronze**: Raw UN/HDX CSV ingestion (`bronze_fts`, `bronze_hno`, `bronze_flood`, etc.)
- **Silver**: ISO3-normalized country facts (`silver_country_daily` joins all sources)
- **Gold**: Weighted risk scoring → `gold_country_risk_daily`

**Risk Score Formula** (0–1 scale):
- 40% funding gap ratio
- 30% humanitarian need ratio
- 20% flood exposure
- 10% HRP requirements

**Status thresholds**: Green < 0.33, Yellow 0.33–0.66, Red ≥ 0.66

The daily Databricks job (`databricks/jobs/daily_pipeline.json`) runs at 06:00 UTC: ingest → silver transform → gold scoring.

### Frontend API Routes (`frontend/app/api/`)
- `GET /api/countries/risk` — queries `gold_country_risk_serving` via Databricks SQL; supports `?asOf=YYYY-MM-DD`
- `POST /api/query` — natural language query handler (placeholder for LLM orchestration)
- `POST /api/voice/speak` — ElevenLabs TTS (`eleven_turbo_v2_5`)
- `GET /api/health` — health check

### Key Components (`frontend/components/`)
- **AthenaGlobe.tsx**: Mapbox GL 3D globe; fetches `/api/countries/risk` and colors countries by ISO3 code (green/yellow/red)
- **AthenaWorkspace.tsx**: Main UI with AI chat panel, Web Speech API voice input, and ElevenLabs voice output

### Canonical Key
ISO3 country code (3-letter uppercase) is the join key across all data layers and the frontend map.
