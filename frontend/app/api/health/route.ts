import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "angel-frontend-api",
    timestamp: new Date().toISOString()
  });
}
