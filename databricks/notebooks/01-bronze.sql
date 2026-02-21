CREATE OR REFRESH MATERIALIZED VIEW bronze_fts AS
SELECT
  TRIM(countryCode) AS iso3,
  TRIM(id) AS appeal_id,
  TRIM(name) AS appeal_name,
  TRIM(code) AS appeal_code,
  TRIM(typeId) AS appeal_type_id,
  TRIM(typeName) AS appeal_type_name,
  TO_DATE(startDate) AS start_date,
  TO_DATE(endDate) AS end_date,
  CAST(year AS INT) AS year,
  CAST(requirements AS DOUBLE) AS requirements_usd,
  CAST(funding AS DOUBLE) AS funding_usd,
  CAST(percentFunded AS DOUBLE) AS percent_funded
FROM workspace.default.fts_requirements_funding_global
WHERE TRIM(countryCode) RLIKE '^[A-Z]{3}$';

CREATE OR REFRESH MATERIALIZED VIEW bronze_hno AS
SELECT
  TRIM(`Country ISO3`) AS iso3,
  TRIM(Description) AS description,
  TRIM(Cluster) AS cluster,
  CAST(Population AS DOUBLE) AS population,
  CAST(`In Need` AS DOUBLE) AS in_need,
  CAST(Targeted AS DOUBLE) AS targeted,
  CAST(Affected AS DOUBLE) AS affected,
  CAST(Reached AS DOUBLE) AS reached
FROM workspace.default.hpc_hno_2026
WHERE TRIM(`Country ISO3`) RLIKE '^[A-Z]{3}$';

CREATE OR REFRESH MATERIALIZED VIEW bronze_flood AS
SELECT
  TRIM(adm0_iso3) AS iso3,
  TRIM(adm0_name) AS country_name,
  TRIM(admin_level) AS admin_level,
  TO_DATE(start_date) AS start_date,
  TO_DATE(end_date) AS end_date,
  CAST(pop_exposed AS DOUBLE) AS pop_exposed,
  CAST(perc_total_area_flooded AS DOUBLE) AS perc_total_area_flooded
FROM workspace.default.global_flood_events_fao_eve
WHERE TRIM(adm0_iso3) RLIKE '^[A-Z]{3}$';

CREATE OR REFRESH MATERIALIZED VIEW bronze_boundaries_meta AS
SELECT
  TRIM(country_iso3) AS iso3,
  TRIM(country_name) AS country_name,
  TRIM(version) AS boundary_version,
  CAST(admin_level_max AS INT) AS admin_level_max,
  TO_DATE(date_updated) AS boundary_date_updated,
  TRIM(update_type) AS update_type
FROM workspace.default.global_admin_boundaries_metadata_latest
WHERE TRIM(country_iso3) RLIKE '^[A-Z]{3}$';

-- If your source table name is different, update this FROM target.
CREATE OR REFRESH MATERIALIZED VIEW bronze_hrp_raw AS
SELECT
  TRIM(code) AS code,
  CAST(internalId AS BIGINT) AS internal_id,
  TO_DATE(startDate) AS start_date,
  TO_DATE(endDate) AS end_date,
  TRIM(planVersion) AS plan_version,
  TRIM(categories) AS categories,
  TRIM(locations) AS locations,
  TRIM(years) AS years,
  CAST(origRequirements AS DOUBLE) AS orig_requirements_usd,
  CAST(revisedRequirements AS DOUBLE) AS revised_requirements_usd
FROM workspace.default.humanitarian_response_plans;