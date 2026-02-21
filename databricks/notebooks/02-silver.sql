CREATE OR REFRESH MATERIALIZED VIEW silver_country_spine AS
SELECT DISTINCT iso3 FROM bronze_fts WHERE iso3 RLIKE '^[A-Z]{3}$'
UNION
SELECT DISTINCT iso3 FROM bronze_hno WHERE iso3 RLIKE '^[A-Z]{3}$'
UNION
SELECT DISTINCT iso3 FROM bronze_flood WHERE iso3 RLIKE '^[A-Z]{3}$'
UNION
SELECT DISTINCT iso3 FROM bronze_boundaries_meta WHERE iso3 RLIKE '^[A-Z]{3}$'
UNION
SELECT DISTINCT TRIM(x.iso3) AS iso3
FROM bronze_hrp_raw h
LATERAL VIEW explode(split(COALESCE(h.locations, ''), '\\|')) x AS iso3
WHERE TRIM(x.iso3) RLIKE '^[A-Z]{3}$';

CREATE OR REFRESH MATERIALIZED VIEW silver_fts AS
WITH year_coverage AS (
  SELECT CAST(year AS INT) AS year, COUNT(DISTINCT iso3) AS country_count
  FROM bronze_fts
  WHERE year IS NOT NULL AND requirements_usd IS NOT NULL
  GROUP BY CAST(year AS INT)
),
latest_reliable_year AS (
  SELECT MAX(year) AS y FROM year_coverage WHERE country_count >= 80
)
SELECT
  f.iso3,
  CAST(f.year AS INT) AS year,
  SUM(COALESCE(f.requirements_usd, 0)) AS requirements_usd,
  SUM(COALESCE(f.funding_usd, 0)) AS funding_usd,
  AVG(f.percent_funded) AS percent_funded_avg,
  CASE
    WHEN SUM(COALESCE(f.requirements_usd, 0)) > 0
      THEN (SUM(COALESCE(f.requirements_usd, 0)) - SUM(COALESCE(f.funding_usd, 0)))
           / SUM(COALESCE(f.requirements_usd, 0))
    ELSE NULL
  END AS funding_gap_ratio
FROM bronze_fts f
JOIN latest_reliable_year y ON CAST(f.year AS INT) = y.y
GROUP BY f.iso3, CAST(f.year AS INT);

CREATE OR REFRESH MATERIALIZED VIEW silver_hno AS
SELECT
  iso3,
  SUM(COALESCE(in_need, 0)) AS in_need,
  SUM(COALESCE(targeted, 0)) AS targeted,
  MAX(population) AS population
FROM bronze_hno
GROUP BY iso3;

CREATE OR REFRESH MATERIALIZED VIEW silver_flood AS
SELECT
  iso3,
  SUM(COALESCE(pop_exposed, 0)) AS flood_pop_exposed,
  AVG(perc_total_area_flooded) AS flood_area_pct
FROM bronze_flood
GROUP BY iso3;

CREATE OR REFRESH MATERIALIZED VIEW silver_hrp AS
WITH exploded AS (
  SELECT
    TRIM(x.iso3) AS iso3,
    revised_requirements_usd
  FROM bronze_hrp_raw h
  LATERAL VIEW explode(split(COALESCE(h.locations, ''), '\\|')) x AS iso3
)
SELECT
  iso3,
  SUM(COALESCE(revised_requirements_usd, 0)) AS revised_requirements_usd
FROM exploded
WHERE iso3 RLIKE '^[A-Z]{3}$'
GROUP BY iso3;

CREATE OR REFRESH MATERIALIZED VIEW silver_country_daily AS
SELECT
  s.iso3,
  f.year,
  f.requirements_usd,
  f.funding_usd,
  f.percent_funded_avg,
  f.funding_gap_ratio,
  h.in_need,
  h.targeted,
  CASE WHEN h.population > 0 THEN h.in_need / h.population ELSE NULL END AS in_need_ratio,
  fl.flood_pop_exposed,
  fl.flood_area_pct,
  hr.revised_requirements_usd,
  COALESCE(b.country_name, NULL) AS country_name,
  b.admin_level_max,
  b.boundary_date_updated,
  CURRENT_DATE() AS as_of_date
FROM silver_country_spine s
LEFT JOIN silver_fts f ON s.iso3 = f.iso3
LEFT JOIN silver_hno h ON s.iso3 = h.iso3
LEFT JOIN silver_flood fl ON s.iso3 = fl.iso3
LEFT JOIN silver_hrp hr ON s.iso3 = hr.iso3
LEFT JOIN bronze_boundaries_meta b ON s.iso3 = b.iso3;