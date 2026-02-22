const VOICE_ASSISTANT_ENABLED_KEY = "athena.voiceAssistantEnabled";

function canUseBrowserStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function readVoiceAssistantEnabled(defaultValue = true): boolean {
  if (!canUseBrowserStorage()) {
    return defaultValue;
  }
  const raw = window.localStorage.getItem(VOICE_ASSISTANT_ENABLED_KEY);
  if (raw == null) {
    return defaultValue;
  }
  return raw === "true";
}

export function writeVoiceAssistantEnabled(value: boolean): void {
  if (!canUseBrowserStorage()) {
    return;
  }
  window.localStorage.setItem(VOICE_ASSISTANT_ENABLED_KEY, String(value));
}

export function getVoiceAssistantEnabledStorageKey(): string {
  return VOICE_ASSISTANT_ENABLED_KEY;
}
