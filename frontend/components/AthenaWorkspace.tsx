"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Droplets, Mic, MicOff, Send, Sparkles, Volume2, VolumeX, X } from "lucide-react";
import AthenaGlobe, { type GlobeHighlight } from "@/components/AthenaGlobe";
import countryCentroids from "@/lib/countryCentroids";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type CountryResult = {
  iso3?: string;
  summary?: string;
};

type QueryResponse = {
  intent?: string;
  responseSource?: "gemini" | "fallback";
  answer?: string;
  explanation?: string;
  filters?: Record<string, unknown>;
  countries?: Array<{
    iso3?: string;
    country?: string | null;
    status?: string;
    riskScore?: number;
    summary?: string;
  }>;
};

function toAssistantMessage(response: QueryResponse): string {
  if (response.answer && response.answer.trim()) {
    const tag = response.responseSource === "gemini" ? "Gemini" : "Fallback";
    return `[${tag}]\n${response.answer.trim()}`;
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

export default function AthenaWorkspace() {
  const [isPanelOpen, setPanelOpen] = useState(false);
  const [isDataPanelOpen, setDataPanelOpen] = useState(true);
  const [mode, setMode] = useState<"risk" | "flood">("risk");
  const [isSending, setSending] = useState(false);
  const [isListening, setListening] = useState(false);
  const [isVoiceEnabled, setVoiceEnabled] = useState(true);
  const [voiceStatus, setVoiceStatus] = useState("Voice ready");
  const [input, setInput] = useState("");
  const recognitionRef = useRef<InstanceType<SpeechRecognitionCtor> | null>(null);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const [highlights, setHighlights] = useState<GlobeHighlight[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "Athena online. Ask: 'Where are wars happening right now?'"
    }
  ]);

  const canSend = useMemo(() => input.trim().length > 0 && !isSending, [input, isSending]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      activeAudioRef.current?.pause();
    };
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
        throw new Error("Voice service unavailable");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      activeAudioRef.current?.pause();
      activeAudioRef.current = audio;
      setVoiceStatus("Athena speaking...");
      audio.onended = () => {
        URL.revokeObjectURL(url);
        setVoiceStatus("Voice ready");
      };
      await audio.play();
    } catch {
      setVoiceStatus("Voice failed, text still available");
    }
  }

  async function sendQuestion(question: string) {
    const userMessage: ChatMessage = {
      id: `${Date.now()}-user`,
      role: "user",
      text: question
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setSending(true);

    try {
      const response = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question })
      });

      if (!response.ok) {
        throw new Error(`Query request failed (${response.status})`);
      }

      const payload = (await response.json()) as QueryResponse;
      const assistantText = toAssistantMessage(payload);

      // Parse countries into globe highlights
      if (payload.countries && Array.isArray(payload.countries)) {
        const parsed: GlobeHighlight[] = payload.countries
          .filter((c): c is { iso3: string; summary?: string } =>
            typeof c.iso3 === "string" && c.iso3 in countryCentroids
          )
          .slice(0, 5)
          .map((c) => ({
            iso3: c.iso3,
            summary: c.summary ?? "",
            center: countryCentroids[c.iso3],
          }));
        setHighlights(parsed);
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-assistant`,
          role: "assistant",
          text: assistantText
        }
      ]);
      void speakText(assistantText);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setMessages((prev) => [
        ...prev,
        { id: `${Date.now()}-assistant-error`, role: "assistant", text: `Error: ${message}` }
      ]);
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
      <header className="topbar">
        <div>
          <h1>Project Athena</h1>
          <p>Global humanitarian intelligence (green/yellow/red)</p>
        </div>
        <div className="topbar-actions">
          <button
            className="ai-toggle"
            type="button"
            onClick={() => setDataPanelOpen((prev) => !prev)}
            aria-expanded={isDataPanelOpen}
            aria-controls="athena-data-panel"
          >
            <Droplets size={16} />
            {isDataPanelOpen ? "Hide Data Modes" : "Show Data Modes"}
          </button>
          <button
            className="ai-toggle"
            type="button"
            onClick={() => setPanelOpen((prev) => !prev)}
            aria-expanded={isPanelOpen}
            aria-controls="athena-ai-panel"
          >
            <Sparkles size={16} />
            {isPanelOpen ? "Close Athena AI" : "Open Athena AI"}
          </button>
        </div>
      </header>

      <section className="map-wrap">
        <AthenaGlobe mode={mode} highlights={highlights} />
      </section>

      {isDataPanelOpen ? (
        <aside id="athena-data-panel" className="data-panel">
          <div className="ai-panel-header">
            <span className="ai-panel-title">
              <Droplets size={16} />
              Data Dashboard
            </span>
            <button
              className="icon-btn"
              onClick={() => setDataPanelOpen(false)}
              aria-label="Close data dashboard"
            >
              <X size={16} />
            </button>
          </div>
          <div className="data-panel-body">
            <p className="data-panel-copy">
              Toggle map modes to compare overall risk with flood intensity.
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
          </div>
        </aside>
      ) : null}

      {isPanelOpen ? (
        <aside id="athena-ai-panel" className="ai-panel">
          <div className="ai-panel-header">
            <span className="ai-panel-title">
              <Bot size={16} />
              Athena Assistant
            </span>
            <button className="icon-btn" onClick={() => setPanelOpen(false)} aria-label="Close Athena AI panel">
              <X size={16} />
            </button>
          </div>
          <div className="ai-voice-controls">
            <button type="button" className="icon-btn" onClick={() => setVoiceEnabled((prev) => !prev)} aria-label="Toggle voice replies">
              {isVoiceEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
            <button type="button" className={`icon-btn ${isListening ? "icon-btn-live" : ""}`} onClick={toggleListening} aria-label="Toggle microphone">
              {isListening ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
            <span className="voice-status">{voiceStatus}</span>
          </div>
          <div className="ai-messages">
            {messages.map((message) => (
              <div key={message.id} className={`chat-bubble chat-${message.role}`}>
                {message.text}
              </div>
            ))}
          </div>
          <form className="ai-input-row" onSubmit={onSubmit}>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask Athena..."
              aria-label="Ask Athena"
            />
            <button type="submit" disabled={!canSend}>
              {isSending ? "..." : <Send size={15} />}
            </button>
          </form>
        </aside>
      ) : null}
    </main>
  );
}
