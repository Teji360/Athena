-- Step 06: DLT-safe forecasting source.
-- NOTE: In DLT, MERGE/CREATE TABLE are not allowed in SQL transformation files.
-- This materialized view is a clean projection for forecast jobs.
CREATE OR REFRESH MATERIALIZED VIEW gold_country_risk_history_store AS
SELECT
  iso3,
  country_name,
  as_of_date,
  year,
  risk_score_raw,
  risk_score,
  status,
  requirements_usd,
  funding_usd,
  funding_gap_ratio,
  percent_funded_avg,
  in_need,
  targeted,
  in_need_ratio,
  flood_pop_exposed,
  flood_area_pct,
  revised_requirements_usd,
  population_growth_pct,
  fertility_rate,
  under5_mortality_per_1000,
  maternal_mortality_per_100k,
  life_expectancy_years,
  recommended_actions,
  computed_at
FROM gold_country_risk_daily
WHERE iso3 RLIKE '^[A-Z]{3}$';
