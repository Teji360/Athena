import { NextRequest, NextResponse } from "next/server";
import { getDatabricksConfig, runDatabricksQuery } from "@/lib/databricks";

type CountryRisk = {
  iso3: string;
  country: string | null;
  riskScore: number;
  status: "green" | "yellow" | "red";
  asOfDate: string | null;
  fundingGapRatio: number | null;
  inNeed: number | null;
  floodPopExposed: number | null;
  recommendedActions: string | null;
};

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toNumberOrNull(value: unknown): number | null {
  if (value == null) {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readField(
  row: Record<string, unknown>,
  named: string,
  positional: string
): unknown {
  if (named in row) {
    return row[named];
  }
  return row[positional];
}

function toCountryRisk(row: Record<string, unknown>): CountryRisk | null {
  const iso3Value = readField(row, "iso3", "col_0");
  const statusValue = readField(row, "status", "col_3");
  const riskScoreValue = readField(row, "risk_score", "col_4");
  const iso3 = typeof iso3Value === "string" ? iso3Value : "";
  const status = typeof statusValue === "string" ? statusValue : "";
  const riskScore = toNumberOrNull(riskScoreValue);
  if (!iso3 || (status !== "green" && status !== "yellow" && status !== "red") || riskScore == null) {
    return null;
  }
  return {
    iso3,
    country:
      typeof readField(row, "country_name", "col_1") === "string"
        ? (readField(row, "country_name", "col_1") as string)
        : null,
    riskScore,
    status,
    asOfDate:
      typeof readField(row, "as_of_date", "col_2") === "string"
        ? (readField(row, "as_of_date", "col_2") as string)
        : null,
    fundingGapRatio: toNumberOrNull(readField(row, "funding_gap_ratio", "col_5")),
    inNeed: toNumberOrNull(readField(row, "in_need", "col_6")),
    floodPopExposed: toNumberOrNull(readField(row, "flood_pop_exposed", "col_7")),
    recommendedActions:
      typeof readField(row, "recommended_actions", "col_8") === "string"
        ? (readField(row, "recommended_actions", "col_8") as string)
        : null
  };
}

export async function GET(request: NextRequest) {
  const asOf = request.nextUrl.searchParams.get("asOf");
  const config = getDatabricksConfig();

  if (!config.host || !config.token || !config.warehouseId) {
    return NextResponse.json(
      { error: "Databricks is not configured on this server." },
      { status: 500 }
    );
  }

  if (asOf && !isIsoDate(asOf)) {
    return NextResponse.json(
      { error: "Invalid asOf format. Use YYYY-MM-DD." },
      { status: 400 }
    );
  }

  const table = config.riskTable ?? "workspace.default.gold_country_risk_serving";
  const sql = asOf
    ? `
SELECT
  iso3,
  country_name,
  as_of_date,
  status,
  risk_score,
  funding_gap_ratio,
  in_need,
  flood_pop_exposed,
  recommended_actions
FROM ${table}
WHERE as_of_date = DATE '${asOf}'
ORDER BY risk_score DESC
  `
    : `
SELECT
  iso3,
  country_name,
  as_of_date,
  status,
  risk_score,
  funding_gap_ratio,
  in_need,
  flood_pop_exposed,
  recommended_actions
FROM ${table}
ORDER BY computed_at DESC, risk_score DESC
LIMIT 1000
  `;

  try {
    const rows = await runDatabricksQuery(sql);
    const data = rows
      .map(toCountryRisk)
      .filter((item): item is CountryRisk => item !== null);

    return NextResponse.json({
      asOf: asOf ?? null,
      count: data.length,
      data
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to query Databricks.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
