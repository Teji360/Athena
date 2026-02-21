CREATE OR REFRESH MATERIALIZED VIEW gold_country_risk_daily AS
WITH base AS (
  SELECT
    iso3,
    country_name,
    as_of_date,
    year,
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
    LEAST(GREATEST(COALESCE(funding_gap_ratio, 0.0), 0.0), 1.0) AS funding_component,
    LEAST(GREATEST(COALESCE(in_need_ratio, 0.0), 0.0), 1.0) AS need_component,
    LEAST(GREATEST(COALESCE(flood_area_pct / 100.0, 0.0), 0.0), 1.0) AS flood_component,
    COALESCE(revised_requirements_usd, 0.0) AS hrp_component_raw,
    (
      0.50 * LEAST(GREATEST(COALESCE(under5_mortality_per_1000 / 200.0, 0.0), 0.0), 1.0) +
      0.30 * LEAST(GREATEST(COALESCE(maternal_mortality_per_100k / 600.0, 0.0), 0.0), 1.0) +
      0.20 * LEAST(GREATEST(COALESCE(population_growth_pct / 4.0, 0.0), 0.0), 1.0)
    ) AS demographic_component
  FROM silver_country_daily
),
norm AS (
  SELECT
    *,
    CASE
      WHEN MAX(hrp_component_raw) OVER () > MIN(hrp_component_raw) OVER ()
      THEN (hrp_component_raw - MIN(hrp_component_raw) OVER ())
           / (MAX(hrp_component_raw) OVER () - MIN(hrp_component_raw) OVER ())
      ELSE 0.0
    END AS hrp_component
  FROM base
),
scored AS (
  SELECT
    *,
    (
      0.35 * funding_component +
      0.25 * need_component +
      0.20 * flood_component +
      0.10 * hrp_component +
      0.10 * demographic_component
    ) AS risk_score_raw
  FROM norm
),
scaled AS (
  SELECT
    *,
    CASE
      WHEN MAX(risk_score_raw) OVER () > MIN(risk_score_raw) OVER ()
      THEN (risk_score_raw - MIN(risk_score_raw) OVER ())
           / (MAX(risk_score_raw) OVER () - MIN(risk_score_raw) OVER ())
      ELSE 0.0
    END AS risk_score
  FROM scored
),
bands AS (
  SELECT
    percentile_approx(risk_score, 0.80) AS red_cutoff,
    percentile_approx(risk_score, 0.50) AS yellow_cutoff
  FROM scaled
)
SELECT
  iso3,
  country_name,
  as_of_date,
  year,
  risk_score_raw,
  risk_score,
  CASE
    WHEN risk_score >= b.red_cutoff THEN 'red'
    WHEN risk_score >= b.yellow_cutoff THEN 'yellow'
    ELSE 'green'
  END AS status,
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
  CASE
    WHEN risk_score >= b.red_cutoff THEN 'Immediate action: surge funding, emergency logistics, and multi-sector response.'
    WHEN risk_score >= b.yellow_cutoff THEN 'Escalate monitoring and pre-position targeted resources.'
    ELSE 'Maintain baseline support and preparedness.'
  END AS recommended_actions,
  CURRENT_TIMESTAMP() AS computed_at
FROM scaled
CROSS JOIN bands b;