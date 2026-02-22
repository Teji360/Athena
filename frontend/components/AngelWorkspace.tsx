"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Droplets, Mic, MicOff, Send, Volume2, VolumeX } from "lucide-react";
import AngelGlobe, { type GlobeHighlight } from "@/components/AngelGlobe";
import SsdClusterPanel from "@/components/SsdClusterPanel";
import countryCentroids from "@/lib/countryCentroids";
import countyResourcesRaw from "@/lib/ssdCountyResources.json";
import {
  getVoiceAssistantEnabledStorageKey,
  readVoiceAssistantEnabled,
  writeVoiceAssistantEnabled
} from "@/lib/settings";

type QueryResponse = {
  intent?: string;
  responseSource?: "gemini" | "fallback";
  answer?: string;
  explanation?: string;
  filters?: {
    mode?: "risk" | "flood" | "sudan_map" | "forecast_30d";
    action?: "zoom_country";
    iso3?: string | null;
    focus?: string;
    level?: string;
    status?: string[];
    sudanLayers?: Partial<SudanMapLayers>;
  };
  countries?: Array<{
    iso3?: string;
    country?: string | null;
    status?: string;
    riskScore?: number;
    summary?: string;
  }>;
};

type QueryMapMode = "risk" | "flood" | "sudan_map" | "forecast_30d";

type SsdHungerRow = {
  adm1State: string;
  adm2County: string;
  hungerGamPct: number | null;
  priorityScore: number | null;
  priorityBand: "green" | "yellow" | "red";
  healthFacilityCount: number | null;
  idpIndividuals: number | null;
};

type SudanMapLayers = {
  hunger: boolean;
  displacement: boolean;
  facilities: boolean;
  markets: boolean;
};

type CountyFacility = {
  name: string;
  type: string;
  county: string;
  state: string;
  lat: number;
  lon: number;
  distKm: number;
};

type CountyMarket = {
  name: string;
  county: string;
  state: string;
  lat: number;
  lon: number;
  distKm: number;
};

type CountyResources = {
  pcode: string;
  county: string;
  state: string;
  centroidLat: number;
  centroidLon: number;
  topFacilities: CountyFacility[];
  topMarkets: CountyMarket[];
};

const countyResourcesData = countyResourcesRaw as Record<string, CountyResources>;

const countyResourcesByName = new Map<string, CountyResources>();
for (const entry of Object.values(countyResourcesData)) {
  countyResourcesByName.set(entry.county.toLowerCase(), entry);
  countyResourcesByName.set(entry.county.toLowerCase().replace(/-/g, " "), entry);
}

type FacilityAllocation = {
  name: string;
  type: string;
  distKm: number;
  allocPct: number;
  kind: "facility" | "market";
};

type CountyAllocation = {
  key: string;
  county: string;
  state: string;
  priorityBand: "green" | "yellow" | "red";
  priorityScore: number | null;
  facilities: FacilityAllocation[];
  markets: FacilityAllocation[];
};

function countyAllocationScore(row: SsdHungerRow): number {
  const priority = row.priorityScore ?? 0;
  const idpNorm = Math.min((row.idpIndividuals ?? 0) / 50000, 1);
  const facilityCount = row.healthFacilityCount ?? 0;
  const facilityScarcity = facilityCount === 0 ? 1 : Math.min(15 / facilityCount, 1);
  const hungerNorm = Math.min(Math.max(row.hungerGamPct ?? 0, 0) / 30, 1);
  return 0.55 * priority + 0.20 * idpNorm + 0.15 * facilityScarcity + 0.10 * hungerNorm;
}

function proximityWeight(distKm: number): number {
  return 1 / Math.max(distKm, 1);
}

function toAssistantMessage(response: QueryResponse): string {
  if (response.answer && response.answer.trim()) {
    return response.answer.trim();
  }
  const intent = response.intent ?? "unknown_intent";
  const explanation = response.explanation ?? "No explanation was returned.";
  const topCountries = (response.countries ?? [])
    .slice(0, 3)
    .map((country) => {
      const name = country.country ?? country.iso3 ?? "Unknown";
      const iso3 = country.iso3 ? ` (${country.iso3})` : "";
      const status = country.status ? ` - ${country.status}` : "";
      const risk =
        typeof country.riskScore === "number" ? `, risk ${country.riskScore.toFixed(3)}` : "";
      return `${name}${iso3}${status}${risk}`;
    })
    .join("\n");
  return topCountries
    ? `Intent: ${intent}\n${explanation}\n\nTop matches:\n${topCountries}`
    : `Intent: ${intent}\n${explanation}`;
}

type SpeechRecognitionCtor = new () => {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type SudanView = "map" | "clusters";

export default function AngelWorkspace() {
  const [mode, setMode] = useState<QueryMapMode>("risk");
  const [sudanView, setSudanView] = useState<SudanView>("map");
  const [sudanLayers, setSudanLayers] = useState<SudanMapLayers>({
    hunger: true,
    displacement: true,
    facilities: false,
    markets: false
  });
  const [ssdRows, setSsdRows] = useState<SsdHungerRow[]>([]);
  const [ssdError, setSsdError] = useState<string | null>(null);
  const [isSending, setSending] = useState(false);
  const [isListening, setListening] = useState(false);
  const [isVoiceEnabled, setVoiceEnabled] = useState(true);
  const [voiceStatus, setVoiceStatus] = useState("Voice ready");
  const [input, setInput] = useState("");
  const [autoSubmit, setAutoSubmit] = useState(true);
  const recognitionRef = useRef<InstanceType<SpeechRecognitionCtor> | null>(null);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  const [highlights, setHighlights] = useState<GlobeHighlight[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [expandedCounties, setExpandedCounties] = useState<Set<string>>(new Set());

  const canSend = useMemo(() => input.trim().length > 0 && !isSending, [input, isSending]);

  const facilityAllocations = useMemo((): CountyAllocation[] => {
    const top8 = ssdRows.slice(0, 8);
    if (top8.length === 0) return [];

    // Collect all raw scores for normalization
    const entries: { countyKey: string; kind: "facility" | "market"; idx: number; name: string; type: string; distKm: number; rawScore: number }[] = [];

    const countyAllocMap = new Map<string, { county: string; state: string; priorityBand: "green" | "yellow" | "red"; priorityScore: number | null }>();

    for (const row of top8) {
      const key = `${row.adm1State}-${row.adm2County}`;
      const cScore = countyAllocationScore(row);
      const resources = countyResourcesByName.get(row.adm2County.toLowerCase());
      countyAllocMap.set(key, { county: row.adm2County, state: row.adm1State, priorityBand: row.priorityBand, priorityScore: row.priorityScore });

      if (resources) {
        for (let i = 0; i < resources.topFacilities.length; i++) {
          const f = resources.topFacilities[i];
          entries.push({ countyKey: key, kind: "facility", idx: i, name: f.name, type: f.type, distKm: f.distKm, rawScore: cScore * proximityWeight(f.distKm) });
        }
        for (let i = 0; i < resources.topMarkets.length; i++) {
          const m = resources.topMarkets[i];
          entries.push({ countyKey: key, kind: "market", idx: i, name: m.name, type: "WFP", distKm: m.distKm, rawScore: cScore * proximityWeight(m.distKm) });
        }
      }
    }

    const totalRaw = entries.reduce((sum, e) => sum + e.rawScore, 0);

    // Build grouped result
    const result: CountyAllocation[] = [];
    for (const row of top8) {
      const key = `${row.adm1State}-${row.adm2County}`;
      const meta = countyAllocMap.get(key)!;
      const facilities: FacilityAllocation[] = entries
        .filter((e) => e.countyKey === key && e.kind === "facility")
        .map((e) => ({ name: e.name, type: e.type, distKm: e.distKm, allocPct: totalRaw > 0 ? (e.rawScore / totalRaw) * 100 : 0, kind: "facility" as const }));
      const markets: FacilityAllocation[] = entries
        .filter((e) => e.countyKey === key && e.kind === "market")
        .map((e) => ({ name: e.name, type: e.type, distKm: e.distKm, allocPct: totalRaw > 0 ? (e.rawScore / totalRaw) * 100 : 0, kind: "market" as const }));
      result.push({ key, county: meta.county, state: meta.state, priorityBand: meta.priorityBand, priorityScore: meta.priorityScore, facilities, markets });
    }
    return result;
  }, [ssdRows]);

  // Load autoSubmit preference from localStorage
  useEffect(() => {
    const stored = localStorage.getItem("angel-auto-submit");
    if (stored !== null) setAutoSubmit(stored === "true");
  }, []);

  // Auto-focus chat input on mount
  useEffect(() => {
    chatInputRef.current?.focus();
  }, []);

  // Auto-clear status toast after 6 seconds
  useEffect(() => {
    if (!statusMessage) return;
    const timer = setTimeout(() => setStatusMessage(null), 6000);
    return () => clearTimeout(timer);
  }, [statusMessage]);



  // Debounced auto-submit for external voice-to-text (e.g. Wispr Flow)
  useEffect(() => {
    if (!autoSubmit || !input.trim() || isSending) return;
    const timer = setTimeout(() => {
      const question = input.trim();
      if (question) void sendQuestion(question);
    }, 800);
    return () => clearTimeout(timer);
  }, [input, autoSubmit, isSending]);


  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      activeAudioRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    setVoiceEnabled(readVoiceAssistantEnabled(true));
    const storageKey = getVoiceAssistantEnabledStorageKey();
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey) {
        setVoiceEnabled(readVoiceAssistantEnabled(true));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    async function fetchSouthSudanHunger() {
      try {
        const response = await fetch("/api/south-sudan/hunger");
        if (!response.ok) {
          throw new Error(`South Sudan hunger API failed (${response.status})`);
        }
        const payload = (await response.json()) as {
          data?: Array<{
            adm1State?: string;
            adm2County?: string;
            hungerGamPct?: number | null;
            priorityScore?: number | null;
            priorityBand?: "green" | "yellow" | "red";
            healthFacilityCount?: number | null;
            idpIndividuals?: number | null;
          }>;
        };
        const rows = (payload.data ?? [])
          .filter(
            (row) =>
              typeof row.adm1State === "string" &&
              typeof row.adm2County === "string" &&
              (row.priorityBand === "green" || row.priorityBand === "yellow" || row.priorityBand === "red")
          )
          .map((row) => ({
            adm1State: row.adm1State as string,
            adm2County: row.adm2County as string,
            hungerGamPct: typeof row.hungerGamPct === "number" ? row.hungerGamPct : null,
            priorityScore: typeof row.priorityScore === "number" ? row.priorityScore : null,
            priorityBand: row.priorityBand as "green" | "yellow" | "red",
            healthFacilityCount: typeof row.healthFacilityCount === "number" ? row.healthFacilityCount : null,
            idpIndividuals: typeof row.idpIndividuals === "number" ? row.idpIndividuals : null
          }));
        setSsdRows(rows);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to fetch South Sudan hunger data";
        setSsdError(message);
      }
    }

    void fetchSouthSudanHunger();
  }, []);

  async function speakText(text: string) {
    if (!isVoiceEnabled) {
      return;
    }
    try {
      const response = await fetch("/api/voice/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          details?: string;
        };
        // Silently skip if ElevenLabs isn't configured on the server
        if (response.status === 500 && payload.error?.includes("Missing ElevenLabs")) {
          return;
        }
        const message = payload.error ?? "Voice service unavailable";
        const details = payload.details ? `: ${payload.details}` : "";
        throw new Error(`${message}${details}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      activeAudioRef.current?.pause();
      activeAudioRef.current = audio;
      setVoiceStatus("Angel speaking...");
      audio.onended = () => {
        URL.revokeObjectURL(url);
        setVoiceStatus("Voice ready");
      };
      await audio.play();
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message.slice(0, 120)
          : "Voice failed, text still available";
      setVoiceStatus(message);
    }
  }

  async function sendQuestion(question: string) {
    setInput("");
    setSending(true);

    try {
      const response = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, mode })
      });

      if (!response.ok) {
        throw new Error(`Query request failed (${response.status})`);
      }

      const payload = (await response.json()) as QueryResponse;
      const assistantText = toAssistantMessage(payload);

      if (payload.filters?.mode) {
        setMode(payload.filters.mode);
      }
      if (payload.filters?.sudanLayers) {
        setSudanLayers((prev) => ({ ...prev, ...payload.filters!.sudanLayers }));
      }

      const silentActions = new Set(["ui_toggle_panel", "ui_toggle_layers", "ui_mode_switch"]);
      const isSilent = silentActions.has(payload.intent ?? "");

      // Parse countries into globe highlights
      if (payload.countries && Array.isArray(payload.countries)) {
        const parsed: GlobeHighlight[] = payload.countries
          .filter((c): c is { iso3: string; country?: string | null; summary?: string; paeScore?: number; riskScore?: number } =>
            typeof c.iso3 === "string" && c.iso3 in countryCentroids
          )
          .slice(0, 5)
          .map((c) => {
            const name = c.country ?? c.iso3;
            const pae = (c as Record<string, unknown>).paeScore;
            const countryLabel = typeof pae === "number"
              ? `${name} (${c.iso3}) — ${pae.toFixed(1)}% population exposed to unsafe PM2.5`
              : `${name} (${c.iso3})`;
            return {
              iso3: c.iso3,
              summary: countryLabel,
              center: countryCentroids[c.iso3]
            };
          });
        const firstParsed = parsed[0];
        if (firstParsed) {
          // For multi-country results, show each country as a navigable highlight
          if (parsed.length > 1) {
            setHighlights(parsed.map((h, i) => i === 0 ? { ...h, summary: assistantText } : h));
          } else {
            setHighlights([{ ...firstParsed, summary: assistantText }]);
          }
        } else if (
          payload.filters?.action === "zoom_country" &&
          typeof payload.filters.iso3 === "string" &&
          payload.filters.iso3 in countryCentroids
        ) {
          setHighlights([
            {
            iso3: payload.filters.iso3,
              summary: assistantText,
            center: countryCentroids[payload.filters.iso3]
            }
          ]);
        } else {
          setHighlights([]);
          if (!isSilent && assistantText) {
            setStatusMessage(assistantText);
          }
        }
      } else {
        setHighlights([]);
        if (!isSilent && assistantText) {
          setStatusMessage(assistantText);
        }
      }
      if (!isSilent) {
        void speakText(assistantText);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setStatusMessage(`Error: ${message}`);
    } finally {
      setSending(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = input.trim();
    if (!question || isSending) {
      return;
    }
    setInput("");
    await sendQuestion(question);
  }

  function toggleListening() {
    if (isListening) {
      recognitionRef.current?.stop();
      setListening(false);
      setVoiceStatus("Voice ready");
      return;
    }
    const SpeechRecognitionClass = (
      window as Window & {
        webkitSpeechRecognition?: SpeechRecognitionCtor;
        SpeechRecognition?: SpeechRecognitionCtor;
      }
    ).SpeechRecognition ??
      (
        window as Window & {
          webkitSpeechRecognition?: SpeechRecognitionCtor;
          SpeechRecognition?: SpeechRecognitionCtor;
        }
      ).webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      setVoiceStatus("Speech recognition unavailable in this browser");
      return;
    }

    const recognition = new SpeechRecognitionClass();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim();
      if (transcript) {
        setInput(transcript);
        void sendQuestion(transcript);
      }
    };
    recognition.onerror = () => {
      setVoiceStatus("Mic error, try again");
    };
    recognition.onend = () => {
      setListening(false);
      setVoiceStatus("Voice ready");
    };
    recognitionRef.current = recognition;
    setListening(true);
    setVoiceStatus("Listening...");
    recognition.start();
  }

  return (
    <main className="page">
      <section className="map-wrap">
        <AngelGlobe mode={mode} highlights={highlights} sudanLayers={sudanLayers} />
      </section>

      <aside id="angel-data-panel" className="data-panel">
          <div className="ai-panel-header">
            <span className="ai-panel-title">
              <Droplets size={16} />
              Data Dashboard
            </span>
          </div>
          <div className="data-panel-body">
            <p className="data-panel-copy">
              Toggle map modes to compare global risk, flood pressure, and South Sudan county hunger priority.
            </p>
            <button
              type="button"
              className={`mode-btn ${mode === "risk" ? "mode-btn-active" : ""}`}
              onClick={() => setMode("risk")}
            >
              Crisis Risk Mode
            </button>
            <button
              type="button"
              className={`mode-btn ${mode === "flood" ? "mode-btn-active" : ""}`}
              onClick={() => setMode("flood")}
            >
              Flood Depth Mode
            </button>
            <button
              type="button"
              className={`mode-btn ${mode === "forecast_30d" ? "mode-btn-active" : ""}`}
              onClick={() => setMode("forecast_30d")}
            >
              Forecast 30d Mode
            </button>
            <button
              type="button"
              className={`mode-btn ${mode === "sudan_map" ? "mode-btn-active" : ""}`}
              onClick={() => setMode("sudan_map")}
            >
              Sudan Map Mode
            </button>
            {mode === "sudan_map" ? (
              <>
                {/* View toggle tabs */}
                <div className="sudan-view-tabs">
                  <button
                    type="button"
                    className={`sudan-view-tab ${sudanView === "map" ? "active" : ""}`}
                    onClick={() => setSudanView("map")}
                  >
                    Map Layers
                  </button>
                  <button
                    type="button"
                    className={`sudan-view-tab ${sudanView === "clusters" ? "active" : ""}`}
                    onClick={() => setSudanView("clusters")}
                  >
                    UN Clusters
                  </button>
                </div>

                {sudanView === "map" ? (
                  <>
                    <div className="ssd-priority-panel">
                      <div className="ssd-priority-title">Layers</div>
                      <label className="layer-check">
                        <input
                          type="checkbox"
                          checked={sudanLayers.hunger}
                          onChange={(event) =>
                            setSudanLayers((prev) => ({ ...prev, hunger: event.target.checked }))
                          }
                        />
                        Hunger priority
                      </label>
                      <label className="layer-check">
                        <input
                          type="checkbox"
                          checked={sudanLayers.displacement}
                          onChange={(event) =>
                            setSudanLayers((prev) => ({
                              ...prev,
                              displacement: event.target.checked
                            }))
                          }
                        />
                        Displacement pressure
                      </label>
                      <label className="layer-check">
                        <input
                          type="checkbox"
                          checked={sudanLayers.facilities}
                          onChange={(event) =>
                            setSudanLayers((prev) => ({ ...prev, facilities: event.target.checked }))
                          }
                        />
                        Health facilities
                      </label>
                      <label className="layer-check">
                        <input
                          type="checkbox"
                          checked={sudanLayers.markets}
                          onChange={(event) =>
                            setSudanLayers((prev) => ({ ...prev, markets: event.target.checked }))
                          }
                        />
                        Markets
                      </label>
                    </div>

                    <div className="ssd-priority-panel">
                      <div className="ssd-priority-title">Top South Sudan county priorities</div>
                      {facilityAllocations.map((ca) => {
                        const isExpanded = expandedCounties.has(ca.key);
                        return (
                          <div key={ca.key}>
                            <div
                              className="ssd-priority-row ssd-priority-row-expandable"
                              onClick={() =>
                                setExpandedCounties((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(ca.key)) next.delete(ca.key);
                                  else next.add(ca.key);
                                  return next;
                                })
                              }
                            >
                              <span>
                                <span className="ssd-expand-chevron">{isExpanded ? "▾" : "▸"}</span>{" "}
                                {ca.county}, {ca.state}
                              </span>
                              <span>
                                {ca.priorityBand.toUpperCase()} | {ca.priorityScore?.toFixed(3) ?? "N/A"}
                              </span>
                            </div>
                            {isExpanded && (
                              <div className="ssd-facility-expand">
                                {ca.facilities.length > 0 && (
                                  <div className="county-action-section">
                                    <div className="county-action-section-title" style={{ color: "#ef4444" }}>
                                      Hospitals &amp; Health Facilities
                                    </div>
                                    <div className="county-action-list">
                                      {ca.facilities.map((f, i) => (
                                        <div className="county-action-item" key={f.name}>
                                          <span className="county-action-rank">{i + 1}</span>
                                          <div className="county-action-item-body">
                                            <span className="county-action-item-name">{f.name}</span>
                                            <span className="county-action-item-meta">
                                              {f.type} · {f.distKm.toFixed(1)}km
                                              <span className="ssd-alloc-badge">{f.allocPct.toFixed(1)}%</span>
                                            </span>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {ca.markets.length > 0 && (
                                  <div className="county-action-section">
                                    <div className="county-action-section-title" style={{ color: "#f59e0b" }}>
                                      Food &amp; Shelter Distribution
                                    </div>
                                    <div className="county-action-list">
                                      {ca.markets.map((m, i) => (
                                        <div className="county-action-item" key={m.name}>
                                          <span className="county-action-rank">{i + 1}</span>
                                          <div className="county-action-item-body">
                                            <span className="county-action-item-name">{m.name}</span>
                                            <span className="county-action-item-meta">
                                              {m.type} · {m.distKm.toFixed(1)}km
                                              <span className="ssd-alloc-badge">{m.allocPct.toFixed(1)}%</span>
                                            </span>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {ca.facilities.length === 0 && ca.markets.length === 0 && (
                                  <div className="county-action-section">
                                    <span className="county-action-empty">No facility data available</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {facilityAllocations.length > 0 && (
                        <div className="ssd-alloc-footer">
                          {facilityAllocations.reduce((sum, ca) => sum + ca.facilities.length + ca.markets.length, 0)} locations · 100% allocation
                        </div>
                      )}
                      {ssdError ? <div className="ssd-priority-error">{ssdError}</div> : null}
                    </div>
                  </>
                ) : (
                  <SsdClusterPanel />
                )}
              </>
            ) : null}
          </div>
        </aside>

      {statusMessage && (
        <div className="status-toast" onClick={() => setStatusMessage(null)}>
          {statusMessage}
        </div>
      )}

      <div className="bottom-prompt-wrap">
        <div className="bottom-prompt-controls">
          <button
            type="button"
            className="icon-btn"
            onClick={() =>
              setVoiceEnabled((prev) => {
                const next = !prev;
                writeVoiceAssistantEnabled(next);
                return next;
              })
            }
            aria-label="Toggle voice replies"
          >
            {isVoiceEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
          <button
            type="button"
            className={`icon-btn ${isListening ? "icon-btn-live" : ""}`}
            onClick={toggleListening}
            aria-label="Toggle microphone"
          >
            {isListening ? <MicOff size={16} /> : <Mic size={16} />}
          </button>
          <label className="auto-submit-toggle" title="Auto-submit when external voice typing stops">
            <input
              type="checkbox"
              checked={autoSubmit}
              onChange={(event) => {
                const next = event.target.checked;
                setAutoSubmit(next);
                localStorage.setItem("angel-auto-submit", String(next));
              }}
            />
            Auto
          </label>
          <span className="voice-status">{voiceStatus}</span>
        </div>
        <form className="bottom-prompt-input-row" onSubmit={onSubmit}>
          <input
            ref={chatInputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask Angel..."
            aria-label="Ask Angel"
          />
          <button type="submit" disabled={!canSend}>
            {isSending ? "..." : <Send size={15} />}
          </button>
        </form>
        {isSending && <div className="prompt-loading-bar" />}
      </div>
    </main>
  );
}
