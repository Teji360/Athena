# Angel Architecture (Scaffold)

## Layers

1. Data ingestion (Databricks jobs)
2. App + API layer (Next.js route handlers)
3. Globe UI (React + Mapbox GL in Next.js)

## Data model targets

- `bronze_hdx_*`: raw ingested tables
- `silver_*`: normalized ISO3 country facts
- `gold_country_risk_daily`: map-ready status and score

## Risk status

- `green`: low-risk / relatively stable
- `yellow`: warning / deteriorating
- `red`: crisis / immediate action required

## Planned API routes

- `GET /api/health`
- `GET /api/countries/risk?asOf=YYYY-MM-DD`
- `POST /api/query` (natural language map query)

## Deployment shape

- Frontend/app layer: Vercel (Next.js)
- Data + compute: Databricks (SQL warehouse + jobs)
- Integration: Next.js route handlers call Databricks SQL APIs
