import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

type AirQualityRow = {
  iso3: string;
  country: string;
  paeScore: number;
  status: "green" | "yellow" | "red";
};

function statusFromPae(pae: number): "green" | "yellow" | "red" {
  // WHO guideline: PM2.5 annual mean < 15 µg/m³ is acceptable
  // PAE = % population exposed to levels exceeding WHO guideline
  if (pae >= 60) return "red";
  if (pae >= 30) return "yellow";
  return "green";
}

export async function GET() {
  try {
    const csvPath = path.resolve(process.cwd(), "..", "data", "air_quality_pae.csv");
    const raw = await readFile(csvPath, "utf8");
    const lines = raw.trim().split("\n");

    if (lines.length < 2) {
      return NextResponse.json({ data: [] });
    }

    // Header: "code","iso","country","PAE.ind.1995",...,"PAE.ind.2024"
    const header = lines[0].replace(/"/g, "").split(",");
    // Use the most recent year column (last column)
    const latestColIndex = header.length - 1;

    const data: AirQualityRow[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.replace(/"/g, "").trim());
      const iso3 = cols[1];
      const country = cols[2];
      const valueStr = cols[latestColIndex];

      if (!iso3 || iso3.length !== 3 || !country) continue;
      if (valueStr === "NA" || valueStr === "" || valueStr === undefined) continue;

      const paeScore = parseFloat(valueStr);
      if (!Number.isFinite(paeScore)) continue;

      data.push({
        iso3: iso3.toUpperCase(),
        country,
        paeScore,
        status: statusFromPae(paeScore)
      });
    }

    // Sort by worst air quality first
    data.sort((a, b) => b.paeScore - a.paeScore);

    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load air quality data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
