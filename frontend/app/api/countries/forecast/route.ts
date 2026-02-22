import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runDatabricksQuery } from "@/lib/databricks";

type ForecastRow = {
  iso3: string;
  country: string | null;
  asOfDate: string | null;
  currentRiskScore: number;
  forecastRiskScore: number;
  forecastStatus: "green" | "yellow" | "red";
};

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toStatus(score: number): "green" | "yellow" | "red" {
  if (score > 0.15) return "red";
  if (score > 0.1) return "yellow";
  return "green";
}

function normalizeRow(raw: Record<string, unknown>): ForecastRow | null {
  const iso3 = typeof raw.iso3 === "string" ? raw.iso3.trim().toUpperCase() : "";
  const currentRiskScore = toNumber(raw.currentRiskScore ?? raw.risk_score ?? raw.col_2);
  const forecastRiskScore = toNumber(raw.forecastRiskScore ?? raw.prediction ?? raw.col_3);
  if (!iso3 || currentRiskScore == null || forecastRiskScore == null) {
    return null;
  }
  const country = typeof raw.country === "string" ? raw.country : null;
  const asOfDate = typeof raw.asOfDate === "string" ? raw.asOfDate : typeof raw.as_of_date === "string" ? raw.as_of_date : null;
  const forecastStatusValue = typeof raw.forecastStatus === "string" ? raw.forecastStatus.toLowerCase() : "";
  const forecastStatus =
    forecastStatusValue === "green" || forecastStatusValue === "yellow" || forecastStatusValue === "red"
      ? (forecastStatusValue as "green" | "yellow" | "red")
      : toStatus(forecastRiskScore);
  return {
    iso3,
    country,
    asOfDate,
    currentRiskScore,
    forecastRiskScore,
    forecastStatus
  };
}

function parseCsv(content: string): Array<Record<string, string>> {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) {
    return [];
  }
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const out: Record<string, string> = {};
    headers.forEach((header, idx) => {
      out[header] = (cells[idx] ?? "").trim();
    });
    return out;
  });
}

async function loadFromCsv(): Promise<ForecastRow[]> {
  const csvPath = path.resolve(process.cwd(), "..", "data", "forecast_output.csv");
  const raw = await readFile(csvPath, "utf8");
  const parsed = parseCsv(raw);
  return parsed
    .map((row) =>
      normalizeRow({
        iso3: row.iso3,
        as_of_date: row.as_of_date,
        risk_score: row.risk_score,
        prediction: row.prediction
      })
    )
    .filter((row): row is ForecastRow => row !== null);
}

async function loadFromDatabricks(): Promise<ForecastRow[]> {
  const forecastTable =
    process.env.DATABRICKS_FORECAST_TABLE ?? "workspace.default.forecast_output";
  const riskTable =
    process.env.DATABRICKS_RISK_TABLE ?? "workspace.default.gold_country_risk_serving";
  const sql = `
SELECT
  f.iso3,
  r.country_name AS country,
  CAST(f.as_of_date AS STRING) AS asOfDate,
  CAST(f.risk_score AS DOUBLE) AS currentRiskScore,
  CAST(f.prediction AS DOUBLE) AS forecastRiskScore,
  CASE
    WHEN CAST(f.prediction AS DOUBLE) > 0.15 THEN 'red'
    WHEN CAST(f.prediction AS DOUBLE) > 0.10 THEN 'yellow'
    ELSE 'green'
  END AS forecastStatus
FROM ${forecastTable} f
LEFT JOIN ${riskTable} r
  ON f.iso3 = r.iso3
WHERE f.iso3 IS NOT NULL
ORDER BY forecastRiskScore DESC
`;
  const rows = await runDatabricksQuery(sql);
  return rows.map(normalizeRow).filter((row): row is ForecastRow => row !== null);
}

export async function GET() {
  try {
    const databricksRows = await loadFromDatabricks().catch(() => []);
    if (databricksRows.length > 0) {
      return NextResponse.json(
        {
          source: "databricks",
          asOfDate: databricksRows[0]?.asOfDate ?? null,
          data: databricksRows
        },
        { status: 200, headers: { "Cache-Control": "no-store" } }
      );
    }

    const csvRows = await loadFromCsv();
    return NextResponse.json(
      {
        source: "csv",
        asOfDate: csvRows[0]?.asOfDate ?? null,
        data: csvRows
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load forecast data.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
