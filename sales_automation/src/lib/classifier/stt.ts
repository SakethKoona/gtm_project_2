import WebSocket from "ws";

/**
 * Streaming STT seam for live IVR / hold detection over the Media Stream.
 *
 * The real classifier gets human-vs-machine "for free" from Twilio AMD (a status
 * callback, no audio processing). Detecting an IVR menu or hold music, however,
 * needs the audio: that's what this interface is for. Plug in Deepgram (or a
 * self-hosted Vosk/Whisper websocket) here; transcripts feed the existing
 * HeuristicClassifier to emit IVR_MENU / ON_HOLD / VOICEMAIL events.
 *
 * Without a key this returns null and the real call path relies on AMD alone —
 * enough to reach a human and bridge to a rep, but not to auto-navigate IVRs.
 */
export interface StreamingSTT {
  /** Feed one base64 μ-law audio frame from the Media Stream. */
  pushAudio(base64Payload: string): void;
  /** Register a transcript listener (called as partials/finals arrive). */
  onTranscript(cb: (text: string) => void): void;
  close(): void;
}

/**
 * Deepgram realtime STT over the Twilio Media Stream.
 *
 * Twilio forwards 8kHz mono μ-law (base64) frames; Deepgram's realtime endpoint
 * accepts that exact encoding, so frames are decoded to bytes and forwarded
 * verbatim — no resampling. We open the socket lazily and buffer any frames that
 * arrive before it's connected, then flush on open. Finalized transcript
 * segments (`is_final`) are surfaced to listeners, which feed the classifier /
 * IVR navigator.
 */
class DeepgramStreamingSTT implements StreamingSTT {
  private ws: WebSocket;
  private open = false;
  private closed = false;
  private queue: Buffer[] = [];
  private listeners: ((text: string) => void)[] = [];

  constructor(apiKey: string) {
    // Phone-tuned model by default; override with DEEPGRAM_MODEL if needed.
    const model = process.env.DEEPGRAM_MODEL || "nova-2-phonecall";
    const params = new URLSearchParams({
      encoding: "mulaw", // Twilio Media Stream sends 8kHz μ-law
      sample_rate: "8000",
      channels: "1",
      model,
      language: process.env.DEEPGRAM_LANGUAGE || "en-US",
      punctuate: "true",
      smart_format: "true",
      // Only finalized segments — a whole menu utterance, not word-by-word noise.
      interim_results: "false",
      // Finalize a segment after 300ms of silence (IVR menus pause between items).
      endpointing: "300",
    });

    this.ws = new WebSocket(
      `wss://api.deepgram.com/v1/listen?${params.toString()}`,
      { headers: { Authorization: `Token ${apiKey}` } },
    );

    this.ws.on("open", () => {
      this.open = true;
      for (const buf of this.queue) this.ws.send(buf);
      this.queue = [];
    });

    this.ws.on("message", (data: WebSocket.RawData) => {
      let msg: {
        type?: string;
        channel?: { alternatives?: { transcript?: string }[] };
      };
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return; // ignore non-JSON keepalive frames
      }
      if (msg.type !== "Results") return;
      const text = msg.channel?.alternatives?.[0]?.transcript?.trim();
      if (text) for (const cb of this.listeners) cb(text);
    });

    this.ws.on("error", (e: Error) => {
      console.error("Deepgram STT socket error:", e.message);
    });
    this.ws.on("close", () => {
      this.open = false;
    });
  }

  pushAudio(base64Payload: string): void {
    if (this.closed || !base64Payload) return;
    const buf = Buffer.from(base64Payload, "base64");
    if (this.open && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(buf);
    } else {
      this.queue.push(buf); // flushed on "open"
    }
  }

  onTranscript(cb: (text: string) => void): void {
    this.listeners.push(cb);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.queue = [];
    try {
      if (this.ws.readyState === WebSocket.OPEN) {
        // Ask Deepgram to flush any buffered audio, then close cleanly.
        this.ws.send(JSON.stringify({ type: "CloseStream" }));
      }
      this.ws.close();
    } catch {
      /* already closing */
    }
  }
}

export function getSTT(): StreamingSTT | null {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return null;
  try {
    return new DeepgramStreamingSTT(key);
  } catch (e) {
    console.error(
      "Failed to start Deepgram STT; falling back to AMD-only classification:",
      (e as Error).message,
    );
    return null;
  }
}
