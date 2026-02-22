"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Droplets, Mic, MicOff, Send, Volume2, VolumeX } from "lucide-react";
import AngelGlobe, { type GlobeHighlight } from "@/components/AngelGlobe";
import SsdClusterPanel from "@/components/SsdClusterPanel";
import countryCentroids from "@/lib/countryCentroids";
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

  const canSend = useMemo(() => input.trim().length > 0 && !isSending, [input, isSending]);

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
                      {ssdRows.slice(0, 8).map((row) => (
                        <div key={`${row.adm1State}-${row.adm2County}`} className="ssd-priority-row">
                          <span>
                            {row.adm2County}, {row.adm1State}
                          </span>
                          <span>
                            {row.priorityBand.toUpperCase()} | {row.priorityScore?.toFixed(3) ?? "N/A"}
                          </span>
                        </div>
                      ))}
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
