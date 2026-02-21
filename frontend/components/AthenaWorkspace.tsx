"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Mic, MicOff, Send, Sparkles, Volume2, VolumeX, X } from "lucide-react";
import AthenaGlobe from "@/components/AthenaGlobe";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type QueryResponse = {
  intent?: string;
  explanation?: string;
  filters?: Record<string, unknown>;
};

function toAssistantMessage(response: QueryResponse): string {
  const intent = response.intent ?? "unknown_intent";
  const explanation = response.explanation ?? "No explanation was returned.";
  return `Intent: ${intent}\n${explanation}`;
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
  const [isSending, setSending] = useState(false);
  const [isListening, setListening] = useState(false);
  const [isVoiceEnabled, setVoiceEnabled] = useState(true);
  const [voiceStatus, setVoiceStatus] = useState("Voice ready");
  const [input, setInput] = useState("");
  const recognitionRef = useRef<InstanceType<SpeechRecognitionCtor> | null>(null);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
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
      </header>

      <section className="map-wrap">
        <AthenaGlobe />
      </section>

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
