CREATE OR REFRESH MATERIALIZED VIEW gold_country_risk_serving AS
SELECT
  iso3,
  country_name,
  as_of_date,
  year,
  status,
  risk_score,
  requirements_usd,
  funding_usd,
  funding_gap_ratio,
  percent_funded_avg,
  in_need,
  flood_pop_exposed,
  flood_area_pct,
  revised_requirements_usd,
  recommended_actions,
  computed_at
FROM gold_country_risk_daily;