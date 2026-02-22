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

CREATE OR REFRESH MATERIALIZED VIEW gold_ss_hunger_serving AS
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
  priority_score,
  priority_rank_pct,
  priority_band,
  recommended_actions,
  computed_at
FROM gold_ss_hunger_priority;

CREATE OR REFRESH MATERIALIZED VIEW gold_ss_conflict_forecast_validation_serving AS
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
  alignment_confidence,
  outlook_signal,
  computed_at
FROM gold_ss_cross_validation_conflict_forecast;

CREATE OR REFRESH MATERIALIZED VIEW gold_ss_needs_priority_validation_serving AS
SELECT
  iso3,
  in_need_total,
  targeted_total,
  affected_total,
  reached_total,
  national_target_coverage_ratio,
  avg_county_priority_score,
  red_counties,
  county_count,
  red_county_share,
  avg_cluster_target_coverage_ratio,
  most_undercovered_cluster,
  validation_pressure_score,
  validation_band,
  computed_at
FROM gold_ss_cross_validation_needs_priority;