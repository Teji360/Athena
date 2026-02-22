import { NextRequest, NextResponse } from "next/server";
import { getDatabricksConfig, runDatabricksQuery } from "@/lib/databricks";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { GoogleGenerativeAI } from "@google/generative-ai";

type QueryRequest = {
  question?: string;
  mode?: "risk" | "flood" | "sudan_map" | "forecast_30d";
};

type AgentIntent =
  | "smalltalk"
  | "sudan_map_open"
  | "forecast_outlook"
  | "global_funding_allocation"
  | "flood_hotspots"
  | "crisis_hotspots"
  | "stable_countries"
  | "top_risk_countries"
  | "country_focus"
  | "ssd_hunger_hotspots"
  | "ssd_system_stress"
  | "ssd_hospital_allocation"
  | "air_quality_hotspots"
  | "ui_toggle_layers"
  | "ui_toggle_panel"
  | "ui_mode_switch"
  | "agentic_fallback";

type AgentResult = {
  iso3: string;
  country: string | null;
  status: "green" | "yellow" | "red";
  riskScore: number;
  floodPopExposed: number | null;
  adm1State?: string | null;
  adm2County?: string | null;
  hungerGamPct?: number | null;
  priorityScore?: number | null;
  healthFacilityCount?: number | null;
  marketCount?: number | null;
  idpIndividuals?: number | null;
  returneesInternal?: number | null;
  femaleSharePct?: number | null;
  ethnicSummary?: string | null;
  allocationScore?: number | null;
  spendTier?: string | null;
  recommendedSpendSharePct?: number | null;
  paeScore?: number | null;
};

type ContextSummary = {
  rowCount: number;
  redCount: number;
  yellowCount: number;
  greenCount: number;
  avgRiskScore: number | null;
  topIso3: string[];
};

type QueryMapMode = "risk" | "flood" | "sudan_map" | "forecast_30d";
type IntentDetectionResult = {
  intent: AgentIntent;
  confidence: number;
};

const ALLOWED_INTENTS: AgentIntent[] = [
  "smalltalk",
  "sudan_map_open",
  "forecast_outlook",
  "global_funding_allocation",
  "flood_hotspots",
  "crisis_hotspots",
  "stable_countries",
  "top_risk_countries",
  "country_focus",
  "ssd_hunger_hotspots",
  "ssd_system_stress",
  "ssd_hospital_allocation",
  "air_quality_hotspots",
  "agentic_fallback"
];

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

function normalizeStatus(value: unknown): "green" | "yellow" | "red" | null {
  const status = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (status === "green" || status === "yellow" || status === "red") {
    return status;
  }
  return null;
}

function statusFromRiskScore(riskScore: number): "green" | "yellow" | "red" {
  if (riskScore > 0.15) {
    return "red";
  }
  if (riskScore > 0.1) {
    return "yellow";
  }
  return "green";
}

function sanitizeSqlLikeLiteral(value: string): string {
  return value.replace(/[^a-zA-Z\s-]/g, "").replace(/\s+/g, " ").trim();
}

function extractCountryPhrase(question: string): string | null {
  const q = question.trim();
  if (!q) {
    return null;
  }
  const patterns = [
    /(?:zoom(?:\s+in)?\s+(?:to|on)|focus(?:\s+on)?|go\s+to|show\s+me|center\s+on|move\s+to|soom(?:\s+in)?\s+(?:to|on))\s+([a-zA-Z][a-zA-Z\s'-]{1,60})/i,
    /(?:in|on)\s+([a-zA-Z][a-zA-Z\s'-]{1,60})\s*$/i
  ];
  for (const pattern of patterns) {
    const match = q.match(pattern);
    const phrase = match?.[1] ? sanitizeSqlLikeLiteral(match[1]) : "";
    if (phrase.length >= 3) {
      return phrase;
    }
  }
  return null;
}

function summarizeContext(countries: AgentResult[]): ContextSummary {
  const redCount = countries.filter((c) => c.status === "red").length;
  const yellowCount = countries.filter((c) => c.status === "yellow").length;
  const greenCount = countries.filter((c) => c.status === "green").length;
  const riskValues = countries.map((c) => c.riskScore).filter((n) => Number.isFinite(n));
  const avgRiskScore = riskValues.length
    ? riskValues.reduce((sum, value) => sum + value, 0) / riskValues.length
    : null;
  return {
    rowCount: countries.length,
    redCount,
    yellowCount,
    greenCount,
    avgRiskScore,
    topIso3: countries.slice(0, 5).map((c) => c.iso3)
  };
}

function isSimplePrompt(question: string): boolean {
  const q = question.trim().toLowerCase();
  if (!q) {
    return true;
  }
  const tokenCount = q.split(/\s+/).filter(Boolean).length;
  const deepAnalysisKeywords =
    /(why|how|explain|intercorrelat|interconnect|tradeoff|drivers|strategy|recommend|allocate|forecast|plan|detailed)/.test(
      q
    );
  return tokenCount <= 7 && !deepAnalysisKeywords;
}

function responseStyleFor(intent: AgentIntent, question: string): {
  lengthRule: string;
  actionsRule: string;
} {
  if (intent === "forecast_outlook") {
    return {
      lengthRule: "Keep response concise: 2-3 sentences with forecast focus.",
      actionsRule: 'Include a short "Planning next steps" section with 2 bullets.'
    };
  }
  if (intent === "sudan_map_open") {
    return {
      lengthRule: "Keep it short: 1 sentence.",
      actionsRule: "Do not include recommendation bullets."
    };
  }
  if (intent === "global_funding_allocation") {
    return {
      lengthRule: "Give a practical allocation answer in 3-4 sentences.",
      actionsRule: 'Include a short "Suggested allocation" section with 3 bullets and percentages.'
    };
  }
  if (intent === "smalltalk") {
    return {
      lengthRule: "Keep it conversational and short: 1-2 sentences.",
      actionsRule: "Do not include recommendation bullets."
    };
  }
  if (intent === "air_quality_hotspots") {
    return {
      lengthRule: "Keep response concise: 2-3 sentences focusing on worst air quality countries.",
      actionsRule: 'Include a short "Key findings" section with 2-3 bullets about the worst-affected countries.'
    };
  }
  if (intent === "country_focus" || isSimplePrompt(question)) {
    return {
      lengthRule: "Keep response very short: 1-2 sentences max.",
      actionsRule: "Do not include a full action plan unless user explicitly asks for recommendations."
    };
  }
  if (intent === "ssd_hospital_allocation" || intent === "ssd_system_stress") {
    return {
      lengthRule: "Give a fuller response: 3-5 sentences grounded in data.",
      actionsRule: 'Include a short "Recommended next actions" section with 3 bullets.'
    };
  }
  return {
    lengthRule: "Keep response concise: 2-3 sentences.",
    actionsRule: 'Include 2 brief next-action bullets only if they add value.'
  };
}

async function loadSudanContextText(): Promise<string | null> {
  try {
    const sudanPath = path.resolve(process.cwd(), "..", "databricks", "jobs", "Sudan.text");
    const content = await readFile(sudanPath, "utf8");
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

type AirQualityRecord = {
  iso3: string;
  country: string;
  paeScore: number;
  status: "green" | "yellow" | "red";
};

async function loadAirQualityData(limit: number): Promise<AirQualityRecord[]> {
  const csvPath = path.resolve(process.cwd(), "..", "data", "air_quality_pae.csv");
  const raw = await readFile(csvPath, "utf8");
  const lines = raw.trim().split("\n");
  if (lines.length < 2) return [];

  const header = lines[0].replace(/"/g, "").split(",");
  const latestColIndex = header.length - 1;
  const records: AirQualityRecord[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.replace(/"/g, "").trim());
    const iso3 = cols[1];
    const country = cols[2];
    const valueStr = cols[latestColIndex];
    if (!iso3 || iso3.length !== 3 || !country) continue;
    if (valueStr === "NA" || valueStr === "" || valueStr === undefined) continue;
    const paeScore = parseFloat(valueStr);
    if (!Number.isFinite(paeScore)) continue;
    const status: "green" | "yellow" | "red" = paeScore >= 60 ? "red" : paeScore >= 30 ? "yellow" : "green";
    records.push({ iso3: iso3.toUpperCase(), country, paeScore, status });
  }

  records.sort((a, b) => b.paeScore - a.paeScore);
  return records.slice(0, limit);
}

function smalltalkReply(question: string): string {
  const q = question.toLowerCase();
  if (/(hello|hi|hey|yo|sup)\b/.test(q)) {
    return "Hey — Angel is online. Want a quick country snapshot or a South Sudan county drill-down?";
  }
  if (/(how are you|how's it going|hows it going)/.test(q)) {
    return "Running smoothly and ready. Tell me a country, region, or decision you want help with.";
  }
  if (/(thanks|thank you|thx)/.test(q)) {
    return "Anytime. Ready when you are.";
  }
  return "I’m here. Tell me what you want to explore and I’ll keep it sharp.";
}

function normalizeIntentText(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  return text.slice(start, end + 1);
}

async function detectIntentWithGemini(input: {
  question: string;
  mode?: QueryMapMode;
}): Promise<IntentDetectionResult | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  const modelName = process.env.GEMINI_MODEL ?? "gemini-1.5-flash";
  const prompt = `
Classify the user message into one intent.
Return strict JSON only with keys: intent, confidence.

Allowed intents:
- smalltalk
- sudan_map_open
- forecast_outlook
- global_funding_allocation
- flood_hotspots
- crisis_hotspots
- stable_countries
- top_risk_countries
- country_focus
- ssd_hunger_hotspots
- ssd_system_stress
- ssd_hospital_allocation
- air_quality_hotspots

Rules:
- If user greets only, choose smalltalk.
- If user asks to open/switch Sudan map, choose sudan_map_open.
- If user asks about 30-day forecast/outlook/projection, choose forecast_outlook.
- If user asks where to invest, allocate funds, or distribute budget globally, choose global_funding_allocation.
- If user asks to zoom/focus on a country, choose country_focus.
- If user asks about wars/conflict/crisis, choose crisis_hotspots.
- If user asks about air quality, pollution, PM2.5, particulate matter, smog, or bad air, choose air_quality_hotspots.
- If map mode is sudan_map and user is generic, prefer ssd_system_stress.
- Confidence is 0 to 1.

Current mode: ${input.mode ?? "risk"}
User message: ${input.question}
`.trim();

  try {
    const genai = new GoogleGenerativeAI(apiKey);
    const model = genai.getGenerativeModel({ model: modelName });
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const jsonText = extractJsonObject(text);
    if (!jsonText) {
      return null;
    }
    const parsed = JSON.parse(jsonText) as { intent?: string; confidence?: number };
    const intent = parsed.intent;
    const confidence = Number(parsed.confidence);
    if (!intent || !ALLOWED_INTENTS.includes(intent as AgentIntent) || !Number.isFinite(confidence)) {
      return null;
    }
    return {
      intent: intent as AgentIntent,
      confidence: Math.max(0, Math.min(1, confidence))
    };
  } catch (err) {
    console.error("[detectIntentWithGemini] error:", err);
    return null;
  }
}

function isGreetingOnly(question: string): boolean {
  const q = normalizeIntentText(question);
  if (!q) {
    return false;
  }
  const hasGreeting =
    /(^|\s)(hello|hi|hey|yo|sup|greetings|good morning|good afternoon|good evening|how are you|hows it going|how s it going|nice to meet you|thanks|thank you|thx)(\s|$)/.test(
      q
    ) || /(^|\s)(athena|athina|atena|atina|athinah|athna)(\s|$)/.test(q);
  const hasActionableIntent =
    /(show|zoom|focus|open|switch|map|risk|war|conflict|flood|hunger|country|countries|where|which|analy[sz]e|explain|plan|allocate|budget|hotspot|status)/.test(
      q
    );
  return hasGreeting && !hasActionableIntent;
}

function toAgentResult(row: Record<string, unknown>): AgentResult | null {
  const iso3Value = readField(row, "iso3", "col_0");
  const statusValue =
    readField(row, "status", "col_2") ??
    readField(row, "priority_band", "col_5") ??
    readField(row, "hunger_status", "col_4");
  const riskScoreValue =
    readField(row, "risk_score", "col_3") ??
    readField(row, "priority_score", "col_6") ??
    readField(row, "stress_score", "col_11") ??
    readField(row, "allocation_score", "col_13");
  const iso3 = typeof iso3Value === "string" ? iso3Value : "";
  const riskScore = toNumberOrNull(riskScoreValue);
  const status = statusValue ? normalizeStatus(statusValue) : null;
  const resolvedStatus = riskScore == null ? status : status ?? statusFromRiskScore(riskScore);
  if (!iso3 || resolvedStatus == null || riskScore == null) {
    return null;
  }
  return {
    iso3,
    country:
      typeof readField(row, "country_name", "col_1") === "string"
        ? (readField(row, "country_name", "col_1") as string)
        : null,
    status: resolvedStatus,
    riskScore,
    floodPopExposed: toNumberOrNull(readField(row, "flood_pop_exposed", "col_4")),
    adm1State:
      typeof readField(row, "adm1_state", "col_1") === "string"
        ? (readField(row, "adm1_state", "col_1") as string)
        : null,
    adm2County:
      typeof readField(row, "adm2_county", "col_2") === "string"
        ? (readField(row, "adm2_county", "col_2") as string)
        : null,
    hungerGamPct: toNumberOrNull(readField(row, "hunger_gam_pct", "col_3")),
    priorityScore: toNumberOrNull(readField(row, "priority_score", "col_6")),
    healthFacilityCount: toNumberOrNull(readField(row, "health_facility_count", "col_7")),
    marketCount: toNumberOrNull(readField(row, "wfp_market_count", "col_8")),
    idpIndividuals: toNumberOrNull(readField(row, "idp_individuals_est", "col_9")),
    returneesInternal: toNumberOrNull(readField(row, "returnees_internal_ind_est", "col_10")),
    femaleSharePct: toNumberOrNull(readField(row, "female_share_pct", "col_11")),
    ethnicSummary:
      typeof readField(row, "ethnic_groups_summary", "col_12") === "string"
        ? (readField(row, "ethnic_groups_summary", "col_12") as string)
        : null,
    allocationScore: toNumberOrNull(readField(row, "allocation_score", "col_13")),
    spendTier:
      typeof readField(row, "spend_tier", "col_14") === "string"
        ? (readField(row, "spend_tier", "col_14") as string)
        : null,
    recommendedSpendSharePct: toNumberOrNull(readField(row, "recommended_spend_share_pct", "col_15"))
  };
}

function detectIntent(question: string): AgentIntent {
  const q = normalizeIntentText(question);

  // UI panel toggle
  if (/(show|open|display|reveal).*(data|panel|dashboard|modes)/.test(q)) {
    return "ui_toggle_panel";
  }
  if (/(hide|close|dismiss|collapse).*(data|panel|dashboard|modes)/.test(q)) {
    return "ui_toggle_panel";
  }

  // UI layer toggle
  if (/(show|hide|turn on|turn off|enable|disable|toggle).*(hunger|displacement|facilities|markets)/.test(q)) {
    return "ui_toggle_layers";
  }

  // Explicit mode switch (non-Sudan)
  if (/(switch|change|go|set).*(flood|risk|crisis).*mode/.test(q)) {
    return "ui_mode_switch";
  }
  const asksSudanMap = /(open|show|switch|go to|goto|use|enable|turn on).*(sudan|south sudan).*(map)|(sudan|south sudan).*(map)/.test(
    q
  );
  if (asksSudanMap) {
    return "sudan_map_open";
  }

  if (isGreetingOnly(question)) {
    return "smalltalk";
  }

  const asksNavigation = /(zoom|focus|go to|show me|center on|move to|soom)/.test(q);
  const asksForecast = /(forecast|outlook|projection|predict|next 30 days|30 day|30-day|in 30 days)/.test(
    q
  );
  const explicitCountry = extractCountryPhrase(question);
  const asksSouthSudan = /(south sudan|ssd|juba|equatoria|jonglei|upper nile|unity|warrap)/.test(q);
  const asksHunger = /(hunger|nutrition|malnutrition|gam|food insecurity|county|state|substate|sub-state)/.test(q);
  const asksSystem = /(intercorrelat|interconnect|complex|dynamic|system|drivers|multi-factor|why)/.test(q);
  const asksHospitals = /(hospital|hospitals|hostpital|hostpitals|clinic|facility|facilities|health center)/.test(q);
  const asksAllocation = /(allocat|spend|budget|fund|financ|invest|prioriti[sz]e)/.test(q);
  const asksGlobalFunding =
    /(invest(ed)?|allocate|allocation|budget|funding|distribute|spend|deploy).*(million|billion|usd|dollar|money)/.test(
      q
    ) ||
    /(where would i put it|where should i put it|how should i spend it)/.test(q);

  if (asksNavigation && explicitCountry) {
    return "country_focus";
  }

  if (asksSouthSudan && asksHospitals && asksAllocation) {
    return "ssd_hospital_allocation";
  }
  if (asksForecast) {
    return "forecast_outlook";
  }
  if (asksGlobalFunding || (asksAllocation && !asksSouthSudan && !asksHospitals)) {
    return "global_funding_allocation";
  }

  if (asksSouthSudan && asksHunger) {
    return "ssd_hunger_hotspots";
  }
  if (asksSouthSudan && asksSystem) {
    return "ssd_system_stress";
  }
  if (asksSouthSudan) {
    return "ssd_system_stress";
  }
  if (/(air quality|air pollution|pm2\.?5|particulate|smog|bad air|pollut|emission|ozone|air exposure)/.test(q)) {
    return "air_quality_hotspots";
  }
  if (/(flood|flooding|inundation|water)/.test(q)) {
    return "flood_hotspots";
  }
  if (/(safe|stable|green)/.test(q)) {
    return "stable_countries";
  }
  if (/(war|wars|conflict|fighting|violence|civil war|armed|battle|frontline|crisis|red|hotspot|high risk|danger)/.test(q)) {
    return "crisis_hotspots";
  }
  return "agentic_fallback";
}

function buildSql(
  intent: AgentIntent,
  tables: { risk: string; ssdHunger: string; ssdMass: string },
  limit: number,
  question: string
): string {
  const table = tables.risk;
  const baseSelect = `
SELECT
  iso3,
  country_name,
  status,
  risk_score,
  flood_pop_exposed
FROM ${table}
  `;
  if (intent === "country_focus") {
    const countryPhrase = extractCountryPhrase(question) ?? "";
    const countryToken = sanitizeSqlLikeLiteral(countryPhrase).toUpperCase();
    return `
SELECT
  iso3,
  country_name,
  status,
  risk_score,
  flood_pop_exposed
FROM ${table}
WHERE upper(country_name) LIKE '%${countryToken}%'
   OR upper(iso3) = '${countryToken}'
ORDER BY risk_score DESC
LIMIT ${limit}
`;
  }
  if (intent === "ssd_hunger_hotspots") {
    return `
SELECT
  h.iso3,
  h.adm1_state,
  h.adm2_county,
  h.hunger_gam_pct,
  h.hunger_status,
  h.priority_band,
  h.priority_score,
  m.health_facility_count,
  m.wfp_market_count,
  m.idp_individuals_est,
  m.returnees_internal_ind_est,
  m.female_share_pct,
  m.ethnic_groups_summary
FROM ${tables.ssdHunger} h
LEFT JOIN ${tables.ssdMass} m
  ON h.adm2_pcode = m.county_pcode
 AND m.record_level = 'county'
WHERE h.iso3 = 'SSD'
ORDER BY h.priority_score DESC
LIMIT ${limit}
`;
  }
  if (intent === "ssd_system_stress") {
    return `
SELECT
  h.iso3,
  h.adm1_state,
  h.adm2_county,
  h.hunger_gam_pct,
  h.hunger_status,
  h.priority_band,
  h.priority_score,
  m.health_facility_count,
  m.wfp_market_count,
  m.idp_individuals_est,
  m.returnees_internal_ind_est,
  (
    0.50 * COALESCE(h.priority_score, 0.0) +
    0.25 * LEAST(COALESCE(m.idp_individuals_est, 0.0) / 50000.0, 1.0) +
    0.15 * CASE WHEN COALESCE(m.health_facility_count, 0) = 0 THEN 1.0 ELSE LEAST(20.0 / m.health_facility_count, 1.0) END +
    0.10 * CASE WHEN COALESCE(m.wfp_market_count, 0) = 0 THEN 1.0 ELSE LEAST(2.0 / m.wfp_market_count, 1.0) END
  ) AS stress_score
FROM ${tables.ssdHunger} h
LEFT JOIN ${tables.ssdMass} m
  ON h.adm2_pcode = m.county_pcode
 AND m.record_level = 'county'
WHERE h.iso3 = 'SSD'
ORDER BY stress_score DESC
LIMIT ${limit}
`;
  }
  if (intent === "ssd_hospital_allocation") {
    return `
SELECT
  h.iso3,
  h.adm1_state,
  h.adm2_county,
  h.hunger_gam_pct,
  h.hunger_status,
  h.priority_band,
  h.priority_score,
  COALESCE(m.health_facility_count, 0) AS health_facility_count,
  COALESCE(m.wfp_market_count, 0) AS wfp_market_count,
  COALESCE(m.idp_individuals_est, 0) AS idp_individuals_est,
  COALESCE(m.returnees_internal_ind_est, 0) AS returnees_internal_ind_est,
  m.female_share_pct,
  m.ethnic_groups_summary,
  (
    0.55 * COALESCE(h.priority_score, 0.0) +
    0.20 * LEAST(COALESCE(m.idp_individuals_est, 0.0) / 50000.0, 1.0) +
    0.15 * CASE WHEN COALESCE(m.health_facility_count, 0) = 0 THEN 1.0 ELSE LEAST(15.0 / m.health_facility_count, 1.0) END +
    0.10 * LEAST(GREATEST(COALESCE(h.hunger_gam_pct, 0.0), 0.0) / 30.0, 1.0)
  ) AS allocation_score,
  CASE
    WHEN (
      0.55 * COALESCE(h.priority_score, 0.0) +
      0.20 * LEAST(COALESCE(m.idp_individuals_est, 0.0) / 50000.0, 1.0) +
      0.15 * CASE WHEN COALESCE(m.health_facility_count, 0) = 0 THEN 1.0 ELSE LEAST(15.0 / m.health_facility_count, 1.0) END +
      0.10 * LEAST(GREATEST(COALESCE(h.hunger_gam_pct, 0.0), 0.0) / 30.0, 1.0)
    ) >= 0.70 THEN 'urgent'
    WHEN (
      0.55 * COALESCE(h.priority_score, 0.0) +
      0.20 * LEAST(COALESCE(m.idp_individuals_est, 0.0) / 50000.0, 1.0) +
      0.15 * CASE WHEN COALESCE(m.health_facility_count, 0) = 0 THEN 1.0 ELSE LEAST(15.0 / m.health_facility_count, 1.0) END +
      0.10 * LEAST(GREATEST(COALESCE(h.hunger_gam_pct, 0.0), 0.0) / 30.0, 1.0)
    ) >= 0.45 THEN 'priority'
    ELSE 'sustain'
  END AS spend_tier,
  ROUND(
    100.0 * (
      (
        0.55 * COALESCE(h.priority_score, 0.0) +
        0.20 * LEAST(COALESCE(m.idp_individuals_est, 0.0) / 50000.0, 1.0) +
        0.15 * CASE WHEN COALESCE(m.health_facility_count, 0) = 0 THEN 1.0 ELSE LEAST(15.0 / m.health_facility_count, 1.0) END +
        0.10 * LEAST(GREATEST(COALESCE(h.hunger_gam_pct, 0.0), 0.0) / 30.0, 1.0)
      ) / NULLIF(SUM(
        0.55 * COALESCE(h.priority_score, 0.0) +
        0.20 * LEAST(COALESCE(m.idp_individuals_est, 0.0) / 50000.0, 1.0) +
        0.15 * CASE WHEN COALESCE(m.health_facility_count, 0) = 0 THEN 1.0 ELSE LEAST(15.0 / m.health_facility_count, 1.0) END +
        0.10 * LEAST(GREATEST(COALESCE(h.hunger_gam_pct, 0.0), 0.0) / 30.0, 1.0)
      ) OVER (), 0.0)
    ),
    2
  ) AS recommended_spend_share_pct
FROM ${tables.ssdHunger} h
LEFT JOIN ${tables.ssdMass} m
  ON h.adm2_pcode = m.county_pcode
 AND m.record_level = 'county'
WHERE h.iso3 = 'SSD'
ORDER BY allocation_score DESC
LIMIT ${limit}
`;
  }
  if (intent === "global_funding_allocation") {
    return `
SELECT
  iso3,
  country_name,
  status,
  risk_score,
  flood_pop_exposed,
  COALESCE(risk_score, 0.0) AS allocation_score,
  CASE
    WHEN COALESCE(risk_score, 0.0) >= 0.70 THEN 'urgent'
    WHEN COALESCE(risk_score, 0.0) >= 0.45 THEN 'priority'
    ELSE 'sustain'
  END AS spend_tier,
  ROUND(
    100.0 * COALESCE(risk_score, 0.0) / NULLIF(SUM(COALESCE(risk_score, 0.0)) OVER (), 0.0),
    2
  ) AS recommended_spend_share_pct
FROM ${table}
WHERE COALESCE(risk_score, 0.0) > 0
ORDER BY allocation_score DESC
LIMIT ${limit}
`;
  }
  if (intent === "forecast_outlook") {
    return `${baseSelect}
WHERE COALESCE(risk_score, 0.0) > 0
ORDER BY risk_score DESC
LIMIT ${limit}
`;
  }
  if (intent === "flood_hotspots") {
    return `${baseSelect}
WHERE flood_pop_exposed IS NOT NULL
ORDER BY flood_pop_exposed DESC, risk_score DESC
LIMIT ${limit}
`;
  }
  if (intent === "stable_countries") {
    return `${baseSelect}
WHERE lower(COALESCE(status, '')) = 'green'
ORDER BY risk_score ASC
LIMIT ${limit}
`;
  }
  if (intent === "crisis_hotspots") {
    return `${baseSelect}
WHERE lower(COALESCE(status, '')) IN ('red', 'yellow')
   OR COALESCE(risk_score, 0.0) >= 0.1
ORDER BY risk_score DESC
LIMIT ${limit}
`;
  }
  return `${baseSelect}
ORDER BY risk_score DESC
LIMIT ${limit}
`;
}

function buildExplanation(intent: AgentIntent, countries: AgentResult[], question: string): string {
  if (intent === "sudan_map_open") {
    return "Sudan Map mode enabled. You can now toggle hunger, displacement, facilities, and markets layers.";
  }
  if (intent === "global_funding_allocation" && countries.length === 0) {
    return "I could not compute allocation rows from the current serving data, so I cannot recommend a reliable funding split yet.";
  }
  if (intent === "smalltalk") {
    return smalltalkReply(question);
  }
  if (countries.length === 0) {
    return intent === "crisis_hotspots"
      ? "Live crisis rows were sparse in the current filter, so I recommend using top risk-scoring countries as conflict proxies for immediate action."
      : "I queried the live Databricks serving table, but no rows matched that request.";
  }
  const top = countries.slice(0, 5);
  const compact = intent === "country_focus" || isSimplePrompt(question);
  if (compact) {
    const first = top[0];
    return first
      ? `Focused on ${first.country ?? first.iso3} (${first.iso3}): ${first.status.toUpperCase()}, risk ${first.riskScore.toFixed(3)}.`
      : "Focus command received.";
  }
  const lines =
    intent === "air_quality_hotspots"
      ? top.map(
          (c) =>
            `- ${c.country ?? c.iso3} (${c.iso3}): ${c.status.toUpperCase()}, air exposure ${c.paeScore?.toFixed(1) ?? "N/A"}%`
        )
    : intent === "ssd_hunger_hotspots" ||
    intent === "ssd_system_stress" ||
    intent === "ssd_hospital_allocation" ||
    intent === "global_funding_allocation"
      ? top.map(
          (c) =>
            intent === "global_funding_allocation"
              ? `- ${c.country ?? c.iso3} (${c.iso3}): ${c.status.toUpperCase()}, allocation ${c.allocationScore?.toFixed(3) ?? c.riskScore.toFixed(3)}, suggested share ${c.recommendedSpendSharePct?.toFixed(2) ?? "N/A"}%`
              : `- ${c.adm2County ?? "Unknown county"}, ${c.adm1State ?? "Unknown state"}: ${c.status.toUpperCase()}, hunger GAM ${
                  c.hungerGamPct?.toFixed(1) ?? "N/A"
                }%, priority ${c.priorityScore?.toFixed(3) ?? c.riskScore.toFixed(3)}, IDPs ${c.idpIndividuals?.toLocaleString() ?? "N/A"}, facilities ${
                  c.healthFacilityCount ?? "N/A"
                }${
                  intent === "ssd_hospital_allocation"
                    ? `, allocation ${c.allocationScore?.toFixed(3) ?? "N/A"}, suggested share ${c.recommendedSpendSharePct?.toFixed(2) ?? "N/A"}%`
                    : ""
                }`
        )
      : top.map(
          (c) =>
            `- ${c.country ?? c.iso3} (${c.iso3}): ${c.status.toUpperCase()}, risk ${c.riskScore.toFixed(3)}, flood exposed ${c.floodPopExposed?.toLocaleString() ?? "N/A"}`
        );
  const redCount = top.filter((c) => c.status === "red").length;
  const yellowCount = top.filter((c) => c.status === "yellow").length;
  const greenCount = top.filter((c) => c.status === "green").length;
  const highest = top[0];
  const recommended =
    intent === "ssd_hunger_hotspots" || intent === "ssd_system_stress" || intent === "ssd_hospital_allocation"
      ? [
          intent === "ssd_hospital_allocation"
            ? "Allocate incremental hospital funding to counties with the highest allocation score first."
            : "Prioritize Tier-1 counties with high hunger GAM and weak service capacity first.",
          intent === "ssd_hospital_allocation"
            ? "Use spend tier labels (urgent/priority/sustain) to separate immediate surge support from maintenance funding."
            : "Deploy county nutrition interventions alongside market and facility support, not in isolation.",
          intent === "ssd_hospital_allocation"
            ? "Recompute shares weekly as displacement and hunger indicators update."
            : "Track displacement and returnee pressure weekly to catch spillover risk between neighboring counties."
        ]
      : intent === "global_funding_allocation"
      ? [
          "Allocate most funding to the top-ranked crisis countries by suggested spend share.",
          "Reserve a smaller contingency slice for fast-moving deterioration in adjacent high-risk countries.",
          "Recompute this split frequently as new risk rows arrive."
        ]
      : intent === "air_quality_hotspots"
      ? [
          "Countries with highest particulate air exposure need urgent pollution mitigation and public health response.",
          "Deploy air quality monitoring and health advisory systems in the worst-affected regions.",
          "Coordinate with environmental agencies to address industrial and urban emission sources."
        ]
      : intent === "forecast_outlook"
      ? [
          "Use forecast mode to review expected 30-day risk concentration across countries.",
          "Pre-position teams and funds in countries with highest projected risk first.",
          "Re-run forecast after each fresh Databricks model output to adjust plans."
        ]
      : intent === "flood_hotspots"
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
    intent === "air_quality_hotspots"
      ? "Air quality exposure assessment from environmental dataset (PM2.5 population exposure)"
      : intent === "ssd_hunger_hotspots"
      ? "South Sudan county hunger hotspot assessment from live Databricks data"
      : intent === "ssd_system_stress"
        ? "South Sudan intercorrelated system-stress assessment from live Databricks data"
      : intent === "ssd_hospital_allocation"
        ? "South Sudan hospital spending-allocation assessment from live Databricks data"
      : intent === "global_funding_allocation"
        ? "Global funding allocation assessment from live Databricks risk data"
      : intent === "forecast_outlook"
        ? "30-day forecast outlook from available risk forecasting outputs"
        : intent === "flood_hotspots"
      ? "Flood hotspot assessment from live Databricks data"
      : intent === "stable_countries"
        ? "Stability assessment from live Databricks data"
        : intent === "crisis_hotspots"
          ? "Crisis hotspot assessment from live Databricks data"
          : `Risk assessment for: "${question}"`;

  const highestLine = highest
    ? intent === "ssd_hunger_hotspots" || intent === "ssd_system_stress" || intent === "ssd_hospital_allocation"
      ? `Highest priority right now: ${highest.adm2County ?? "Unknown county"}, ${highest.adm1State ?? "Unknown state"} with score ${
          (highest.allocationScore ?? highest.priorityScore ?? highest.riskScore).toFixed(3)
        }${intent === "ssd_hospital_allocation" ? ` and suggested spend share ${highest.recommendedSpendSharePct?.toFixed(2) ?? "N/A"}%.` : "."}`
      : intent === "global_funding_allocation"
      ? `Top funding destination: ${highest.country ?? highest.iso3} (${highest.iso3}) with suggested share ${highest.recommendedSpendSharePct?.toFixed(2) ?? "N/A"}%.`
      : `Highest priority right now: ${highest.country ?? highest.iso3} (${highest.iso3}) with risk ${highest.riskScore.toFixed(3)}.`
    : "";

  return `${headline}

Top matches:
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
  countries: AgentResult[];
  fallbackExplanation: string;
  contextSummary: ContextSummary;
  mode?: QueryMapMode;
  sudanContextText?: string | null;
}): Promise<{ answer: string; source: "gemini" | "fallback" }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { answer: input.fallbackExplanation, source: "fallback" };
  }

  const model = process.env.GEMINI_MODEL ?? "gemini-1.5-flash";

  const contextCountries = input.countries.slice(0, 12).map((c) => ({
    iso3: c.iso3,
    country: c.country ?? c.iso3,
    status: c.status,
    riskScore: Number(c.riskScore.toFixed(3)),
    floodPopExposed: c.floodPopExposed,
    adm1State: c.adm1State ?? null,
    adm2County: c.adm2County ?? null,
    hungerGamPct: c.hungerGamPct ?? null,
    priorityScore: c.priorityScore ?? null,
    healthFacilityCount: c.healthFacilityCount ?? null,
    marketCount: c.marketCount ?? null,
    idpIndividuals: c.idpIndividuals ?? null,
    returneesInternal: c.returneesInternal ?? null,
    femaleSharePct: c.femaleSharePct ?? null,
    ethnicSummary: c.ethnicSummary ?? null,
    allocationScore: c.allocationScore ?? null,
    spendTier: c.spendTier ?? null,
    recommendedSpendSharePct: c.recommendedSpendSharePct ?? null,
    paeScore: c.paeScore ?? null
  }));
  const style = responseStyleFor(input.intent, input.question);

  const prompt = `
You are Angel, a humanitarian risk analyst.
User question: ${input.question}
Detected intent: ${input.intent}
Current map mode: ${input.mode ?? "risk"}
Context summary:
${JSON.stringify(input.contextSummary, null, 2)}

Grounded data (${input.intent === "air_quality_hotspots" ? "air quality dataset — paeScore is the % of population exposed to PM2.5 levels exceeding WHO guidelines, higher = worse air quality" : "top rows from Databricks serving outputs, including South Sudan county views when relevant"}):
${JSON.stringify(contextCountries, null, 2)}

${input.mode === "sudan_map" && input.sudanContextText ? `Supplemental South Sudan brief (operator-provided context):
${input.sudanContextText}` : ""}

Return:
- ${style.lengthRule}
- ${style.actionsRule}
Rules:
- Only use the grounded data provided.
- If data is incomplete, explicitly say that.
- Be concise and operational.
- For hospital allocation questions, rank counties by allocation score and mention suggested spend-share percentages.
- For country focus commands, acknowledge the requested country and provide a short situational readout from returned rows.
- For global funding allocation questions, provide a practical allocation split using suggested spend-share percentages from the data.
- For air quality questions, use the paeScore field (% population exposed to unsafe PM2.5). Rank countries by paeScore and name the top ones with their scores.
- For forecast outlook questions, focus on expected 30-day changes and planning implications.
`.trim();

  try {
    const genai = new GoogleGenerativeAI(apiKey);
    const geminiModel = genai.getGenerativeModel({ model });
    const result = await geminiModel.generateContent(prompt);
    const text = result.response.text().trim();
    return text
      ? { answer: text, source: "gemini" }
      : { answer: input.fallbackExplanation, source: "fallback" };
  } catch (err) {
    console.error("[generateGeminiAnswer] error:", err);
    return { answer: input.fallbackExplanation, source: "fallback" };
  }
}

async function generateAgenticAnswer(input: {
  question: string;
  mode?: QueryMapMode;
  sudanContextText?: string | null;
}): Promise<{ answer: string; source: "gemini" | "fallback" }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      source: "fallback",
      answer:
        "Generative analysis is temporarily unavailable. The system is configured and will retry automatically. Please ask your question again."
    };
  }

  const modelName = process.env.GEMINI_MODEL ?? "gemini-1.5-flash";

  const sudanSection =
    input.mode === "sudan_map" && input.sudanContextText
      ? `\nOperational Sudan/South Sudan context:\n${input.sudanContextText}\n\nFocus on South Sudan county-level analysis.`
      : input.mode === "sudan_map"
      ? "\nNo supplemental Sudan text was provided. Answer from general knowledge about South Sudan."
      : "";

  const prompt = `
You are Angel, an AI humanitarian analyst.
User question: ${input.question}
${input.mode ? `Current map mode: ${input.mode}` : ""}
${sudanSection}

Instructions:
- Answer directly and confidently.
- Prioritize actionable planning insight.
- Be explicit when uncertainty remains.
- Keep response concise (2-5 sentences).
`.trim();

  try {
    const genai = new GoogleGenerativeAI(apiKey);
    const model = genai.getGenerativeModel({ model: modelName });
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    if (!text) {
      const contextSnippet = input.sudanContextText
        ? ` Based on operational context: ${input.sudanContextText.slice(0, 300)}.`
        : "";
      return {
        source: "fallback",
        answer: `Generative analysis unavailable right now.${contextSnippet} Ask again for a live answer.`
      };
    }
    return { answer: text, source: "gemini" };
  } catch (err) {
    console.error("[generateAgenticAnswer] Gemini SDK error:", err);
    const contextSnippet = input.sudanContextText
      ? ` Based on operational context: ${input.sudanContextText.slice(0, 300)}.`
      : "";
    return {
      source: "fallback",
      answer: `Generative analysis is temporarily unavailable.${contextSnippet} Please ask your question again.`
    };
  }
}

type PlannerResult = {
  intent: AgentIntent;
  effectiveIntent: AgentIntent;
};

type RetrievalResult = {
  countries: AgentResult[];
  filters: Record<string, unknown>;
};

async function planQuery(input: {
  question: string;
  mode?: QueryMapMode;
}): Promise<PlannerResult> {
  const aiDetection = await detectIntentWithGemini({
    question: input.question,
    mode: input.mode
  });
  let intent =
    aiDetection && aiDetection.confidence >= 0.55
      ? aiDetection.intent
      : detectIntent(input.question);
  if (intent === "country_focus" && !extractCountryPhrase(input.question)) {
    intent = detectIntent(input.question);
  }
  return {
    intent,
    effectiveIntent: intent
  };
}

function buildShortcutResponse(input: {
  intent: AgentIntent;
  question: string;
}):
  | {
      filters: Record<string, unknown>;
      answer: string;
    }
  | null {
  const { intent, question } = input;
  if (intent === "sudan_map_open") {
    const answer = buildExplanation(intent, [], question);
    return {
      filters: { mode: "sudan_map", focus: "south_sudan", level: "county" },
      answer
    };
  }
  if (intent === "smalltalk") {
    const answer = smalltalkReply(question);
    return {
      filters: {},
      answer
    };
  }
  if (intent === "ui_toggle_panel") {
    const wantsOpen = /(show|open|display|reveal)/.test(question.toLowerCase());
    return {
      filters: { dataPanelOpen: wantsOpen },
      answer: wantsOpen ? "Opening the data panel." : "Closing the data panel."
    };
  }
  if (intent === "ui_toggle_layers") {
    const q = question.toLowerCase();
    const wantsOn = /(show|turn on|enable)/.test(q);
    const layers: Record<string, boolean> = {};
    if (/hunger/.test(q)) layers.hunger = wantsOn;
    if (/displacement/.test(q)) layers.displacement = wantsOn;
    if (/facilities/.test(q)) layers.facilities = wantsOn;
    if (/markets/.test(q)) layers.markets = wantsOn;
    return {
      filters: { mode: "sudan_map", sudanLayers: layers },
      answer: wantsOn
        ? `Enabled layers: ${Object.keys(layers).join(", ")}.`
        : `Disabled layers: ${Object.keys(layers).join(", ")}.`
    };
  }
  if (intent === "ui_mode_switch") {
    const q = question.toLowerCase();
    const newMode = /flood/.test(q) ? "flood" : "risk";
    return {
      filters: { mode: newMode },
      answer: `Switched to ${newMode} mode.`
    };
  }
  return null;
}

function deriveMapFilters(input: {
  intent: AgentIntent;
  mode?: QueryMapMode;
  topCountryIso3: string | null;
}): Record<string, unknown> {
  const { intent, mode, topCountryIso3 } = input;
  if (
    intent === "ssd_hunger_hotspots" ||
    intent === "ssd_system_stress" ||
    intent === "ssd_hospital_allocation"
  ) {
    return { mode: "risk", focus: "south_sudan", level: "county" };
  }
  if (intent === "air_quality_hotspots") {
    return { mode: "risk" };
  }
  if (intent === "forecast_outlook") {
    return { mode: "forecast_30d" };
  }
  if (intent === "global_funding_allocation") {
    return { mode: "risk", strategy: "global_allocation" };
  }
  if (intent === "country_focus") {
    return { mode: "risk", action: "zoom_country", iso3: topCountryIso3 };
  }
  if (intent === "flood_hotspots") {
    return { mode: "flood" };
  }
  if (intent === "stable_countries") {
    return { status: ["green"], mode: "risk" };
  }
  return { status: ["red", "yellow"], mode: mode === "forecast_30d" ? "forecast_30d" : "risk" };
}

async function executeRetrievalPlan(input: {
  intent: AgentIntent;
  question: string;
  mode?: QueryMapMode;
  tables: { risk: string; ssdHunger: string; ssdMass: string };
}): Promise<RetrievalResult> {
  const sql = buildSql(input.intent, input.tables, 20, input.question);
  const rows = await runDatabricksQuery(sql);
  const countries = rows
    .map(toAgentResult)
    .filter((item): item is AgentResult => item !== null);
  const topCountryIso3 = countries[0]?.iso3 ?? null;
  return {
    countries,
    filters: deriveMapFilters({
      intent: input.intent,
      mode: input.mode,
      topCountryIso3
    })
  };
}

async function synthesizeResponse(input: {
  question: string;
  intent: AgentIntent;
  mode?: QueryMapMode;
  countries: AgentResult[];
}): Promise<{ answer: string; responseSource: "gemini" | "fallback"; explanation: string }> {
  const fallbackExplanation = buildExplanation(input.intent, input.countries, input.question);
  const contextSummary = summarizeContext(input.countries);
  const generated = await generateGeminiAnswer({
    question: input.question,
    intent: input.intent,
    countries: input.countries,
    fallbackExplanation,
    contextSummary,
    mode: input.mode,
    sudanContextText: null
  });
  return {
    answer: generated.answer,
    responseSource: generated.source,
    explanation: fallbackExplanation
  };
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as QueryRequest;
  const question = (body.question ?? "").trim();
  const mode = body.mode;

  if (!question) {
    return NextResponse.json(
      { error: "Please provide a question in { question: string }." },
      { status: 400 }
    );
  }

  if (mode === "sudan_map") {
    const sudanContextText = await loadSudanContextText();
    const generated = await generateAgenticAnswer({ question, mode, sudanContextText });
    return NextResponse.json({
      intent: "ssd_system_stress",
      question,
      filters: { mode: "sudan_map", focus: "south_sudan", level: "county" },
      countries: [],
      responseSource: generated.source,
      answer: generated.answer,
      explanation: generated.answer
    });
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

  const planned = await planQuery({ question, mode });
  const effectiveIntent = planned.effectiveIntent;

  const shortcut = buildShortcutResponse({
    intent: effectiveIntent,
    question
  });
  if (shortcut) {
    return NextResponse.json({
      intent: effectiveIntent,
      question,
      filters: shortcut.filters,
      countries: [],
      responseSource: "fallback",
      answer: shortcut.answer,
      explanation: shortcut.answer
    });
  }

  if (effectiveIntent === "air_quality_hotspots") {
    try {
      const airData = await loadAirQualityData(20);
      const countries: AgentResult[] = airData.map((row) => ({
        iso3: row.iso3,
        country: row.country,
        status: row.status,
        riskScore: row.paeScore / 100, // normalize to 0-1 scale
        floodPopExposed: null,
        paeScore: row.paeScore
      }));
      const filters = deriveMapFilters({ intent: effectiveIntent, mode, topCountryIso3: countries[0]?.iso3 ?? null });
      const fallbackExplanation = buildExplanation(effectiveIntent, countries, question);
      const contextSummary = summarizeContext(countries);
      const generated = await generateGeminiAnswer({
        question,
        intent: effectiveIntent,
        countries,
        fallbackExplanation,
        contextSummary,
        mode
      });
      return NextResponse.json({
        intent: effectiveIntent,
        question,
        filters,
        countries: countries.slice(0, 10),
        responseSource: generated.source,
        answer: generated.answer,
        explanation: fallbackExplanation
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load air quality data";
      return NextResponse.json({
        intent: effectiveIntent,
        question,
        filters: { mode: "risk" },
        countries: [],
        responseSource: "fallback",
        answer: `Air quality data unavailable: ${message}`,
        explanation: `Air quality data unavailable: ${message}`
      });
    }
  }

  if (effectiveIntent === "agentic_fallback") {
    const generated = await generateAgenticAnswer({ question, mode });
    return NextResponse.json({
      intent: "agentic_fallback",
      question,
      filters: {},
      countries: [],
      responseSource: generated.source,
      answer: generated.answer,
      explanation: generated.answer
    });
  }

  const tables = {
    risk: config.riskTable ?? "workspace.default.gold_country_risk_serving",
    ssdHunger: process.env.DATABRICKS_SSD_HUNGER_TABLE ?? "workspace.default.gold_ss_hunger_serving",
    ssdMass: process.env.DATABRICKS_SSD_MASS_TABLE ?? "workspace.default.sudan_mass_information"
  };
  try {
    const retrieval = await executeRetrievalPlan({
      intent: effectiveIntent,
      question,
      mode,
      tables
    });
    const synthesized = await synthesizeResponse({
      question,
      intent: effectiveIntent,
      mode,
      countries: retrieval.countries
    });

    return NextResponse.json({
      intent: effectiveIntent,
      question,
      filters: retrieval.filters,
      countries: retrieval.countries.slice(0, 10),
      responseSource: synthesized.responseSource,
      answer: synthesized.answer,
      explanation: synthesized.explanation
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Databricks query failed.";
    return NextResponse.json(
      {
        intent: effectiveIntent,
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
