import { NextRequest, NextResponse } from "next/server";
import { getDatabricksConfig, runDatabricksQuery } from "@/lib/databricks";

type HungerRow = {
  iso3: string;
  adm1State: string;
  adm2County: string;
  adm2Pcode: string;
  hungerGamPct: number | null;
  hungerStatus: "green" | "yellow" | "red";
  priorityScore: number | null;
  priorityBand: "green" | "yellow" | "red";
  healthFacilityCount: number | null;
  marketCount: number | null;
  idpIndividuals: number | null;
  returneesInternal: number | null;
  latitude: number | null;
  longitude: number | null;
  facilityLatitude: number | null;
  facilityLongitude: number | null;
  marketLatitude: number | null;
  marketLongitude: number | null;
  ethnicSummary: string | null;
  recommendedActions: string | null;
};

function toNumberOrNull(value: unknown): number | null {
  if (value == null) {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readField(row: Record<string, unknown>, named: string, positional: string): unknown {
  if (named in row) {
    return row[named];
  }
  return row[positional];
}

function normalizeBand(value: unknown): "green" | "yellow" | "red" {
  const s = typeof value === "string" ? value.trim().toLowerCase() : "";
  return s === "red" || s === "yellow" ? s : "green";
}

function toHungerRow(row: Record<string, unknown>): HungerRow | null {
  const iso3 = readField(row, "iso3", "col_0");
  const adm1 = readField(row, "adm1_state", "col_1");
  const adm2 = readField(row, "adm2_county", "col_2");
  const pcode = readField(row, "adm2_pcode", "col_3");
  if (
    typeof iso3 !== "string" ||
    typeof adm1 !== "string" ||
    typeof adm2 !== "string" ||
    typeof pcode !== "string"
  ) {
    return null;
  }
  return {
    iso3,
    adm1State: adm1,
    adm2County: adm2,
    adm2Pcode: pcode,
    hungerGamPct: toNumberOrNull(readField(row, "hunger_gam_pct", "col_4")),
    hungerStatus: normalizeBand(readField(row, "hunger_status", "col_5")),
    priorityScore: toNumberOrNull(readField(row, "priority_score", "col_6")),
    priorityBand: normalizeBand(readField(row, "priority_band", "col_7")),
    healthFacilityCount: toNumberOrNull(readField(row, "health_facility_count", "col_8")),
    marketCount: toNumberOrNull(readField(row, "wfp_market_count", "col_9")),
    idpIndividuals: toNumberOrNull(readField(row, "idp_individuals_est", "col_10")),
    returneesInternal: toNumberOrNull(readField(row, "returnees_internal_ind_est", "col_11")),
    latitude: toNumberOrNull(readField(row, "latitude", "col_12")),
    longitude: toNumberOrNull(readField(row, "longitude", "col_13")),
    facilityLatitude: toNumberOrNull(readField(row, "facility_latitude", "col_14")),
    facilityLongitude: toNumberOrNull(readField(row, "facility_longitude", "col_15")),
    marketLatitude: toNumberOrNull(readField(row, "market_latitude", "col_16")),
    marketLongitude: toNumberOrNull(readField(row, "market_longitude", "col_17")),
    ethnicSummary:
      typeof readField(row, "ethnic_groups_summary", "col_18") === "string"
        ? (readField(row, "ethnic_groups_summary", "col_18") as string)
        : null,
    recommendedActions:
      typeof readField(row, "recommended_actions", "col_19") === "string"
        ? (readField(row, "recommended_actions", "col_19") as string)
        : null
  };
}

export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get("state")?.trim() ?? "";
  const config = getDatabricksConfig();
  if (!config.host || !config.token || !config.warehouseId) {
    return NextResponse.json({ error: "Databricks is not configured on this server." }, { status: 500 });
  }

  const table = process.env.DATABRICKS_SSD_HUNGER_TABLE ?? "workspace.default.gold_ss_hunger_serving";
  const stateFilter = state ? `AND lower(adm1_state) = lower('${state.replace(/'/g, "''")}')` : "";
  const enrichedSql = `
SELECT
  h.iso3,
  h.adm1_state,
  h.adm2_county,
  h.adm2_pcode,
  h.hunger_gam_pct,
  h.hunger_status,
  h.priority_score,
  h.priority_band,
  h.health_facility_count,
  h.wfp_market_count,
  h.idp_individuals_est,
  h.returnees_internal_ind_est,
  m.avg_facility_latitude AS facility_latitude,
  m.avg_facility_longitude AS facility_longitude,
  m.avg_market_latitude AS market_latitude,
  m.avg_market_longitude AS market_longitude,
  COALESCE(m.avg_facility_latitude, m.avg_market_latitude) AS latitude,
  COALESCE(m.avg_facility_longitude, m.avg_market_longitude) AS longitude,
  h.ethnic_groups_summary,
  h.recommended_actions
FROM ${table}
 AS h
LEFT JOIN workspace.default.sudan_mass_information m
  ON h.adm2_pcode = m.county_pcode
 AND m.record_level = 'county'
 AND m.iso3 = 'SSD'
WHERE h.iso3 = 'SSD'
  ${stateFilter}
ORDER BY h.priority_score DESC, h.hunger_gam_pct DESC
LIMIT 500
`;

  const baseSql = `
SELECT
  h.iso3,
  h.adm1_state,
  h.adm2_county,
  h.adm2_pcode,
  h.hunger_gam_pct,
  h.hunger_status,
  h.priority_score,
  h.priority_band,
  h.health_facility_count,
  h.wfp_market_count,
  h.idp_individuals_est,
  h.returnees_internal_ind_est,
  CAST(NULL AS DOUBLE) AS facility_latitude,
  CAST(NULL AS DOUBLE) AS facility_longitude,
  CAST(NULL AS DOUBLE) AS market_latitude,
  CAST(NULL AS DOUBLE) AS market_longitude,
  CAST(NULL AS DOUBLE) AS latitude,
  CAST(NULL AS DOUBLE) AS longitude,
  h.ethnic_groups_summary,
  h.recommended_actions
FROM ${table} AS h
WHERE h.iso3 = 'SSD'
  ${stateFilter}
ORDER BY h.priority_score DESC, h.hunger_gam_pct DESC
LIMIT 500
`;

  try {
    let rows: Array<Record<string, unknown>>;
    try {
      rows = await runDatabricksQuery(enrichedSql);
    } catch {
      // Fallback keeps the endpoint alive even when enrichment table is missing.
      rows = await runDatabricksQuery(baseSql);
    }
    const data = rows.map(toHungerRow).filter((item): item is HungerRow => item !== null);
    const avgPriority =
      data.length > 0
        ? data.reduce((sum, row) => sum + (row.priorityScore ?? 0), 0) / data.length
        : null;
    const redCount = data.filter((row) => row.priorityBand === "red").length;
    const yellowCount = data.filter((row) => row.priorityBand === "yellow").length;
    const greenCount = data.filter((row) => row.priorityBand === "green").length;

    return NextResponse.json({
      count: data.length,
      avgPriority,
      statusCounts: { red: redCount, yellow: yellowCount, green: greenCount },
      data
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to query Databricks.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
