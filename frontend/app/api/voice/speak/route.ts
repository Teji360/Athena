import { NextRequest, NextResponse } from "next/server";

type SpeakRequest = {
  text?: string;
};

const DEFAULT_MODEL = "eleven_turbo_v2_5";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as SpeakRequest;
  const text = (body.text ?? "").trim();
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!text) {
    return NextResponse.json({ error: "Missing text" }, { status: 400 });
  }
  if (!apiKey || !voiceId) {
    return NextResponse.json(
      { error: "Missing ElevenLabs server configuration." },
      { status: 500 }
    );
  }

  const elevenResponse = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text,
        model_id: process.env.ELEVENLABS_MODEL_ID ?? DEFAULT_MODEL,
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.75,
          style: 0.55,
          use_speaker_boost: true
        }
      })
    }
  );

  if (!elevenResponse.ok) {
    return NextResponse.json(
      { error: `ElevenLabs request failed (${elevenResponse.status})` },
      { status: 502 }
    );
  }

  const audio = await elevenResponse.arrayBuffer();
  return new NextResponse(audio, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store"
    }
  });
}
