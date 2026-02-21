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

CREATE OR REFRESH MATERIALIZED VIEW gold_ss_hunger_hotspots AS
SELECT
  iso3,
  adm1_state,
  adm1_pcode,
  adm2_county,
  adm2_pcode,
  proxy_gam_2022_pct AS hunger_gam_pct,
  hunger_status,
  CASE
    WHEN proxy_gam_2022_pct >= 20 THEN 'Emergency nutrition surge: deploy OTP/TSFP, MUAC screening, and therapeutic supplies.'
    WHEN proxy_gam_2022_pct >= 10 THEN 'Escalate prevention: targeted supplementary feeding, outreach, and weekly monitoring.'
    ELSE 'Maintain baseline nutrition support and routine surveillance.'
  END AS recommended_actions,
  CURRENT_TIMESTAMP() AS computed_at
FROM silver_ss_nutrition_county
WHERE iso3 = 'SSD';

CREATE OR REFRESH MATERIALIZED VIEW gold_ss_hunger_priority AS
WITH national AS (
  SELECT
    iso3,
    risk_score AS national_risk_score,
    COALESCE(funding_gap_ratio, 0.0) AS national_funding_gap_ratio,
    LEAST(GREATEST(COALESCE(flood_area_pct / 100.0, 0.0), 0.0), 1.0) AS national_flood_component,
    as_of_date
  FROM gold_country_risk_daily
  WHERE iso3 = 'SSD'
),
county_base AS (
  SELECT
    h.iso3,
    h.adm1_state,
    h.adm1_pcode,
    h.adm2_county,
    h.adm2_pcode,
    h.hunger_gam_pct,
    h.hunger_status,
    LEAST(GREATEST(COALESCE(h.hunger_gam_pct / 30.0, 0.0), 0.0), 1.0) AS hunger_component,
    m.population_2025_total,
    m.female_share_pct,
    m.male_share_pct,
    m.health_facility_count,
    m.wfp_market_count,
    m.idp_individuals_est,
    m.returnees_internal_ind_est,
    m.returnees_from_abroad_ind_est,
    m.ethnic_groups_summary,
    n.national_risk_score,
    n.national_funding_gap_ratio,
    n.national_flood_component,
    n.as_of_date
  FROM gold_ss_hunger_hotspots h
  LEFT JOIN silver_ss_mass_county m
    ON h.adm2_pcode = m.adm2_pcode
  LEFT JOIN national n
    ON h.iso3 = n.iso3
),
scored AS (
  SELECT
    *,
    (
      0.45 * hunger_component +
      0.20 * LEAST(COALESCE(idp_individuals_est, 0.0) / 50000.0, 1.0) +
      0.10 * CASE WHEN COALESCE(health_facility_count, 0) = 0 THEN 1.0 ELSE LEAST(20.0 / health_facility_count, 1.0) END +
      0.05 * CASE WHEN COALESCE(wfp_market_count, 0) = 0 THEN 1.0 ELSE LEAST(2.0 / wfp_market_count, 1.0) END +
      0.10 * national_funding_gap_ratio +
      0.05 * national_flood_component +
      0.05 * COALESCE(national_risk_score, 0.0)
    ) AS priority_score_raw
  FROM county_base
),
ranked AS (
  SELECT
    *,
    PERCENT_RANK() OVER (ORDER BY priority_score_raw DESC) AS priority_rank_pct
  FROM scored
)
SELECT
  iso3,
  adm1_state,
  adm1_pcode,
  adm2_county,
  adm2_pcode,
  as_of_date,
  hunger_gam_pct,
  hunger_status,
  population_2025_total,
  female_share_pct,
  male_share_pct,
  health_facility_count,
  wfp_market_count,
  idp_individuals_est,
  returnees_internal_ind_est,
  returnees_from_abroad_ind_est,
  ethnic_groups_summary,
  national_risk_score,
  national_funding_gap_ratio,
  national_flood_component,
  priority_score_raw AS priority_score,
  priority_rank_pct,
  CASE
    WHEN priority_rank_pct <= 0.20 THEN 'red'
    WHEN priority_rank_pct <= 0.50 THEN 'yellow'
    ELSE 'green'
  END AS priority_band,
  CASE
    WHEN priority_rank_pct <= 0.20 THEN 'Tier-1 intervention: immediate surge in therapeutic feeding, county-level outreach teams, and emergency supplies.'
    WHEN priority_rank_pct <= 0.50 THEN 'Tier-2 intervention: targeted supplementary feeding, rapid screening expansion, and weekly monitoring.'
    ELSE 'Tier-3 intervention: maintain routine nutrition programming with biweekly surveillance.'
  END AS recommended_actions,
  CURRENT_TIMESTAMP() AS computed_at
FROM ranked;