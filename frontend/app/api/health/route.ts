import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "athena-frontend-api",
    timestamp: new Date().toISOString()
  });
}
