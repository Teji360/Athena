import { NextRequest, NextResponse } from "next/server";

type CountryRisk = {
  iso3: string;
  country: string;
  riskScore: number;
  status: "green" | "yellow" | "red";
};

const SAMPLE_DATA: CountryRisk[] = [
  { iso3: "AFG", country: "Afghanistan", riskScore: 0.88, status: "red" },
  { iso3: "PAK", country: "Pakistan", riskScore: 0.64, status: "yellow" },
  { iso3: "BRA", country: "Brazil", riskScore: 0.22, status: "green" }
];

export async function GET(request: NextRequest) {
  const asOf = request.nextUrl.searchParams.get("asOf") ?? null;
  return NextResponse.json({
    asOf,
    count: SAMPLE_DATA.length,
    data: SAMPLE_DATA
  });
}
