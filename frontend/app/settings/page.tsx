"use client";

import { useEffect, useState } from "react";
import {
  getVoiceAssistantEnabledStorageKey,
  readVoiceAssistantEnabled,
  writeVoiceAssistantEnabled
} from "@/lib/settings";

export default function SettingsPage() {
  const [voiceEnabled, setVoiceEnabled] = useState(true);

  useEffect(() => {
    setVoiceEnabled(readVoiceAssistantEnabled(true));
  }, []);

  function onToggleVoiceEnabled(nextValue: boolean) {
    setVoiceEnabled(nextValue);
    writeVoiceAssistantEnabled(nextValue);
  }

  return (
    <main className="content-page">
      <section className="content-header">
        <h1>Settings</h1>
        <p>Control global Athena assistant behavior.</p>
      </section>

      <section className="content-card settings-card">
        <div className="settings-row">
          <div>
            <div className="settings-title">Voice Assistant (ElevenLabs)</div>
            <div className="settings-copy">
              When enabled, Athena can read responses out loud using ElevenLabs text-to-speech.
            </div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={voiceEnabled}
              onChange={(event) => onToggleVoiceEnabled(event.target.checked)}
              aria-label="Enable voice assistant"
            />
            <span className="slider" />
          </label>
        </div>

        <div className="settings-meta">
          Stored locally in your browser key: <code>{getVoiceAssistantEnabledStorageKey()}</code>
        </div>
      </section>
    </main>
  );
}
