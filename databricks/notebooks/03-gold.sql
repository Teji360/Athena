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
    LEAST(GREATEST(COALESCE(funding_gap_ratio, 0.0), 0.0), 1.0) AS funding_component,
    LEAST(GREATEST(COALESCE(in_need_ratio, 0.0), 0.0), 1.0) AS need_component,
    LEAST(GREATEST(COALESCE(flood_area_pct / 100.0, 0.0), 0.0), 1.0) AS flood_component,
    COALESCE(revised_requirements_usd, 0.0) AS hrp_component_raw
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
      0.40 * funding_component +
      0.30 * need_component +
      0.20 * flood_component +
      0.10 * hrp_component
    ) AS risk_score
  FROM norm
)
SELECT
  iso3,
  country_name,
  as_of_date,
  year,
  risk_score,
  CASE
    WHEN risk_score >= 0.66 THEN 'red'
    WHEN risk_score >= 0.33 THEN 'yellow'
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
  CASE
    WHEN risk_score >= 0.66 THEN 'Immediate action: surge funding, emergency logistics, and multi-sector response.'
    WHEN risk_score >= 0.33 THEN 'Escalate monitoring and pre-position targeted resources.'
    ELSE 'Maintain baseline support and preparedness.'
  END AS recommended_actions,
  CURRENT_TIMESTAMP() AS computed_at
FROM scored;