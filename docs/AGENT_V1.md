# Angel Agent V1

Angel Agent V1 uses a lightweight intent router and Databricks SQL as its primary tool.

## Runtime Path

1. User asks a question in the assistant panel.
2. Frontend sends `POST /api/query` with `{ question }`.
3. The API route:
   - detects intent from the question text,
   - builds a scoped SQL query against `gold_country_risk_serving`,
   - executes query via Databricks SQL Statements API,
   - returns explanation + top country matches + map filter hints.

## Current Intents

- `flood_hotspots`
- `crisis_hotspots`
- `stable_countries`
- `top_risk_countries` (fallback)

## Why this is agentic

- Tool use: the agent calls Databricks as a data tool.
- Intent planning: route changes by user language.
- Grounded outputs: answers are built from live table results, not hardcoded copy.

## Next Up

- Add country-name entity extraction and drill-down query.
- Add action synthesis (funding + logistics recommendations by country).
- Add query-to-map actions (auto-set mode/filters directly on globe state).
- Add conversation memory for follow-up prompts.
