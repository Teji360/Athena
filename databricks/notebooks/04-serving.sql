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