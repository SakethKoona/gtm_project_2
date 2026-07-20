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

export function getSTT(): StreamingSTT | null {
  if (process.env.DEEPGRAM_API_KEY) {
    // TODO: implement DeepgramStreamingSTT — open a wss to Deepgram's realtime
    // endpoint with encoding=mulaw&sample_rate=8000, forward pushAudio frames,
    // and surface `channel.alternatives[0].transcript` via onTranscript.
    // Left unimplemented deliberately: it needs a live key to validate, and the
    // human→rep bridge path works without it.
    console.warn(
      "DEEPGRAM_API_KEY set but DeepgramStreamingSTT is not implemented yet; " +
        "falling back to AMD-only classification (no live IVR navigation).",
    );
  }
  return null;
}
