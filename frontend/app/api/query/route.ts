import { NextRequest, NextResponse } from "next/server";

type QueryRequest = {
  question?: string;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as QueryRequest;
  const question = (body.question ?? "").trim();

  if (!question) {
    return NextResponse.json(
      { error: "Please provide a question in { question: string }." },
      { status: 400 }
    );
  }

  // Placeholder intent mapping for MVP wiring.
  return NextResponse.json({
    intent: "where_are_wars",
    question,
    filters: { status: ["red", "yellow"] },
    explanation: "Stub response. Replace with LLM + Databricks query orchestration."
  });
}
