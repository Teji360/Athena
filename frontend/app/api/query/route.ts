import { NextRequest, NextResponse } from "next/server";
import { getDatabricksConfig, runDatabricksQuery } from "@/lib/databricks";

type QueryRequest = {
  question?: string;
};

type AgentIntent =
  | "flood_hotspots"
  | "crisis_hotspots"
  | "stable_countries"
  | "top_risk_countries";

type CountryResult = {
  iso3: string;
  country: string | null;
  status: "green" | "yellow" | "red";
  riskScore: number;
  floodPopExposed: number | null;
};

function toNumberOrNull(value: unknown): number | null {
  if (value == null) {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readField(row: Record<string, unknown>, named: string, positional: string) {
  if (named in row) {
    return row[named];
  }
  return row[positional];
}

function toCountryResult(row: Record<string, unknown>): CountryResult | null {
  const iso3Value = readField(row, "iso3", "col_0");
  const statusValue = readField(row, "status", "col_2");
  const riskScoreValue = readField(row, "risk_score", "col_3");
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
    status,
    riskScore,
    floodPopExposed: toNumberOrNull(readField(row, "flood_pop_exposed", "col_4"))
  };
}

function detectIntent(question: string): AgentIntent {
  const q = question.toLowerCase();
  if (/(flood|flooding|inundation|water)/.test(q)) {
    return "flood_hotspots";
  }
  if (/(safe|stable|green)/.test(q)) {
    return "stable_countries";
  }
  if (/(war|conflict|crisis|red|hotspot|high risk|danger)/.test(q)) {
    return "crisis_hotspots";
  }
  return "top_risk_countries";
}

function buildSql(intent: AgentIntent, table: string, limit: number): string {
  const baseSelect = `
SELECT
  iso3,
  country_name,
  status,
  risk_score,
  flood_pop_exposed
FROM ${table}
  `;
  if (intent === "flood_hotspots") {
    return `${baseSelect}
WHERE flood_pop_exposed IS NOT NULL
ORDER BY flood_pop_exposed DESC, risk_score DESC
LIMIT ${limit}
`;
  }
  if (intent === "stable_countries") {
    return `${baseSelect}
WHERE status = 'green'
ORDER BY risk_score ASC
LIMIT ${limit}
`;
  }
  if (intent === "crisis_hotspots") {
    return `${baseSelect}
WHERE status IN ('red', 'yellow')
ORDER BY risk_score DESC
LIMIT ${limit}
`;
  }
  return `${baseSelect}
ORDER BY risk_score DESC
LIMIT ${limit}
`;
}

function buildExplanation(intent: AgentIntent, countries: CountryResult[], question: string): string {
  if (countries.length === 0) {
    return "I queried the live Databricks serving table, but no rows matched that request.";
  }
  const top = countries.slice(0, 5);
  const lines = top.map(
    (c) =>
      `- ${c.country ?? c.iso3} (${c.iso3}): ${c.status.toUpperCase()}, risk ${c.riskScore.toFixed(3)}, flood exposed ${c.floodPopExposed?.toLocaleString() ?? "N/A"}`
  );
  const redCount = top.filter((c) => c.status === "red").length;
  const yellowCount = top.filter((c) => c.status === "yellow").length;
  const greenCount = top.filter((c) => c.status === "green").length;
  const highest = top[0];
  const recommended =
    intent === "flood_hotspots"
      ? [
          "Prioritize rapid flood-response logistics and temporary shelter in the top 2-3 countries.",
          "Pre-position WASH and health supplies in countries with the highest exposed populations.",
          "Run 7-day monitoring for flood spikes and escalate if exposure trend increases."
        ]
      : intent === "stable_countries"
        ? [
            "Keep baseline preparedness active and monitor for risk trend changes.",
            "Reallocate surplus operational bandwidth to high-urgency countries.",
            "Schedule weekly validation checks to prevent silent risk drift."
          ]
        : [
            "Focus immediate resources on red-status countries with highest risk scores.",
            "Pair funding response with logistics and health/shelter interventions.",
            "Re-evaluate country ranking daily as new data lands."
          ];

  const headline =
    intent === "flood_hotspots"
      ? "Flood hotspot assessment from live Databricks data"
      : intent === "stable_countries"
        ? "Stability assessment from live Databricks data"
        : intent === "crisis_hotspots"
          ? "Crisis hotspot assessment from live Databricks data"
          : `Risk assessment for: "${question}"`;

  const highestLine = highest
    ? `Highest priority right now: ${highest.country ?? highest.iso3} (${highest.iso3}) with risk ${highest.riskScore.toFixed(3)}.`
    : "";

  return `${headline}

Top countries:
${lines.join("\n")}

Snapshot of top 5 statuses: red=${redCount}, yellow=${yellowCount}, green=${greenCount}.
${highestLine}

Recommended next actions:
- ${recommended[0]}
- ${recommended[1]}
- ${recommended[2]}`;
}

async function generateGeminiAnswer(input: {
  question: string;
  intent: AgentIntent;
  countries: CountryResult[];
  fallbackExplanation: string;
}): Promise<{ answer: string; source: "gemini" | "fallback" }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { answer: input.fallbackExplanation, source: "fallback" };
  }

  const model = process.env.GEMINI_MODEL ?? "gemini-1.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const contextCountries = input.countries.slice(0, 12).map((c) => ({
    iso3: c.iso3,
    country: c.country ?? c.iso3,
    status: c.status,
    riskScore: Number(c.riskScore.toFixed(3)),
    floodPopExposed: c.floodPopExposed
  }));

  const prompt = `
You are Athena, a humanitarian risk analyst.
User question: ${input.question}
Detected intent: ${input.intent}

Grounded data (top rows from Databricks gold_country_risk_serving):
${JSON.stringify(contextCountries, null, 2)}

Return:
1) 2-4 sentence direct answer.
2) A short "Recommended next actions" section with 3 bullets.
Rules:
- Only use the grounded data provided.
- If data is incomplete, explicitly say that.
- Be concise and operational.
`.trim();

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });
    if (!response.ok) {
      return { answer: input.fallbackExplanation, source: "fallback" };
    }
    const data = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };
    const text =
      data.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("\n")
        .trim() ?? "";
    return text
      ? { answer: text, source: "gemini" }
      : { answer: input.fallbackExplanation, source: "fallback" };
  } catch {
    return { answer: input.fallbackExplanation, source: "fallback" };
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as QueryRequest;
  const question = (body.question ?? "").trim();

  if (!question) {
    return NextResponse.json(
      { error: "Please provide a question in { question: string }." },
      { status: 400 }
    );
  }

  const config = getDatabricksConfig();
  if (!config.host || !config.token || !config.warehouseId) {
    return NextResponse.json(
      {
        intent: "top_risk_countries",
        question,
        filters: {},
        responseSource: "fallback",
        answer:
          "Databricks is not configured yet. Add host/token/warehouse to enable live agent answers.",
        explanation:
          "Databricks is not configured yet. Add host/token/warehouse to enable live agent answers."
      },
      { status: 200 }
    );
  }

  const intent = detectIntent(question);
  const table = config.riskTable ?? "workspace.default.gold_country_risk_serving";
  const sql = buildSql(intent, table, 20);

  try {
    const rows = await runDatabricksQuery(sql);
    const countries = rows
      .map(toCountryResult)
      .filter((item): item is CountryResult => item !== null);

    const filters =
      intent === "flood_hotspots"
        ? { mode: "flood" }
        : intent === "stable_countries"
          ? { status: ["green"], mode: "risk" }
          : { status: ["red", "yellow"], mode: "risk" };

    const fallbackExplanation = buildExplanation(intent, countries, question);
    const generated = await generateGeminiAnswer({
      question,
      intent,
      countries,
      fallbackExplanation
    });

    return NextResponse.json({
      intent,
      question,
      filters,
      countries: countries.slice(0, 10),
      responseSource: generated.source,
      answer: generated.answer,
      explanation: fallbackExplanation
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Databricks query failed.";
    return NextResponse.json(
      {
        intent,
        question,
        filters: {},
        responseSource: "fallback",
        answer: `Agent query failed: ${message}`,
        explanation: `Agent query failed: ${message}`
      },
      { status: 200 }
    );
  }
}
