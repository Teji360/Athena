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

CREATE OR REFRESH MATERIALIZED VIEW gold_ss_cross_validation_conflict_forecast AS
WITH national AS (
  SELECT
    iso3,
    as_of_date,
    risk_score AS national_risk_score,
    funding_gap_ratio AS national_funding_gap_ratio
  FROM gold_country_risk_daily
  WHERE iso3 = 'SSD'
),
conflict_norm AS (
  SELECT
    c.*,
    CASE
      WHEN MAX(c.conflict_main_mean) OVER () > MIN(c.conflict_main_mean) OVER ()
      THEN (c.conflict_main_mean - MIN(c.conflict_main_mean) OVER ())
           / (MAX(c.conflict_main_mean) OVER () - MIN(c.conflict_main_mean) OVER ())
      ELSE 0.0
    END AS conflict_index_norm
  FROM silver_ss_conflict_monthly c
  WHERE c.iso3 = 'SSD'
),
base AS (
  SELECT
    c.iso3,
    c.year,
    c.month,
    c.month_date,
    c.conflict_main_mean,
    c.conflict_main_dich,
    c.conflict_main_mean_ln,
    c.conflict_index_norm,
    f.as_of_date AS forecast_as_of_date,
    f.latest_risk_score,
    f.forecast_30d_score,
    n.national_risk_score,
    n.national_funding_gap_ratio
  FROM conflict_norm c
  LEFT JOIN silver_ss_forecast_latest f ON c.iso3 = f.iso3
  LEFT JOIN national n ON c.iso3 = n.iso3
),
scored AS (
  SELECT
    *,
    COALESCE(forecast_30d_score, 0.0) - COALESCE(national_risk_score, 0.0) AS forecast_risk_delta,
    ABS(COALESCE(conflict_index_norm, 0.0) - COALESCE(forecast_30d_score, 0.0)) AS conflict_forecast_gap
  FROM base
)
SELECT
  iso3,
  year,
  month,
  month_date,
  conflict_main_mean,
  conflict_main_dich,
  conflict_main_mean_ln,
  conflict_index_norm,
  forecast_as_of_date,
  latest_risk_score,
  forecast_30d_score,
  national_risk_score,
  national_funding_gap_ratio,
  forecast_risk_delta,
  conflict_forecast_gap,
  CASE
    WHEN conflict_forecast_gap <= 0.10 THEN 'high'
    WHEN conflict_forecast_gap <= 0.25 THEN 'medium'
    ELSE 'low'
  END AS alignment_confidence,
  CASE
    WHEN forecast_risk_delta > 0.05 THEN 'risk_upside_warning'
    WHEN forecast_risk_delta < -0.05 THEN 'risk_downside_relief'
    ELSE 'stable_outlook'
  END AS outlook_signal,
  CURRENT_TIMESTAMP() AS computed_at
FROM scored;

CREATE OR REFRESH MATERIALIZED VIEW gold_ss_cross_validation_needs_priority AS
WITH county_priority AS (
  SELECT
    iso3,
    AVG(priority_score) AS avg_county_priority_score,
    SUM(CASE WHEN priority_band = 'red' THEN 1 ELSE 0 END) AS red_counties,
    COUNT(*) AS county_count
  FROM gold_ss_hunger_priority
  WHERE iso3 = 'SSD'
  GROUP BY iso3
),
needs AS (
  SELECT
    iso3,
    in_need_total,
    targeted_total,
    affected_total,
    reached_total
  FROM silver_ss_hpc_needs_total
  WHERE iso3 = 'SSD'
),
cluster_pressure AS (
  SELECT
    iso3,
    cluster,
    in_need,
    targeted,
    CASE WHEN in_need > 0 THEN targeted / in_need ELSE NULL END AS cluster_target_coverage_ratio
  FROM silver_ss_hpc_needs_cluster
  WHERE iso3 = 'SSD'
),
cluster_summary AS (
  SELECT
    iso3,
    AVG(COALESCE(cluster_target_coverage_ratio, 0.0)) AS avg_cluster_target_coverage_ratio,
    MAX(CASE WHEN in_need > 0 AND (targeted / in_need) < 0.45 THEN cluster END) AS most_undercovered_cluster
  FROM cluster_pressure
  GROUP BY iso3
)
SELECT
  p.iso3,
  n.in_need_total,
  n.targeted_total,
  n.affected_total,
  n.reached_total,
  CASE WHEN n.in_need_total > 0 THEN n.targeted_total / n.in_need_total ELSE NULL END AS national_target_coverage_ratio,
  p.avg_county_priority_score,
  p.red_counties,
  p.county_count,
  CASE WHEN p.county_count > 0 THEN p.red_counties / p.county_count ELSE NULL END AS red_county_share,
  c.avg_cluster_target_coverage_ratio,
  c.most_undercovered_cluster,
  (
    0.45 * COALESCE(p.avg_county_priority_score, 0.0) +
    0.35 * LEAST(GREATEST(1.0 - COALESCE(CASE WHEN n.in_need_total > 0 THEN n.targeted_total / n.in_need_total ELSE NULL END, 0.0), 0.0), 1.0) +
    0.20 * LEAST(GREATEST(COALESCE(CASE WHEN p.county_count > 0 THEN p.red_counties / p.county_count ELSE NULL END, 0.0), 0.0), 1.0)
  ) AS validation_pressure_score,
  CASE
    WHEN (
      0.45 * COALESCE(p.avg_county_priority_score, 0.0) +
      0.35 * LEAST(GREATEST(1.0 - COALESCE(CASE WHEN n.in_need_total > 0 THEN n.targeted_total / n.in_need_total ELSE NULL END, 0.0), 0.0), 1.0) +
      0.20 * LEAST(GREATEST(COALESCE(CASE WHEN p.county_count > 0 THEN p.red_counties / p.county_count ELSE NULL END, 0.0), 0.0), 1.0)
    ) >= 0.60 THEN 'high_pressure'
    WHEN (
      0.45 * COALESCE(p.avg_county_priority_score, 0.0) +
      0.35 * LEAST(GREATEST(1.0 - COALESCE(CASE WHEN n.in_need_total > 0 THEN n.targeted_total / n.in_need_total ELSE NULL END, 0.0), 0.0), 1.0) +
      0.20 * LEAST(GREATEST(COALESCE(CASE WHEN p.county_count > 0 THEN p.red_counties / p.county_count ELSE NULL END, 0.0), 0.0), 1.0)
    ) >= 0.35 THEN 'medium_pressure'
    ELSE 'lower_pressure'
  END AS validation_band,
  CURRENT_TIMESTAMP() AS computed_at
FROM county_priority p
LEFT JOIN needs n ON p.iso3 = n.iso3
LEFT JOIN cluster_summary c ON p.iso3 = c.iso3;