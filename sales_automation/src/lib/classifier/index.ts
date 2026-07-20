import type { MediaEvent } from "@/lib/telephony/provider";

/** Call states the orchestrator's state machine acts on (spec §3). */
export type CallState =
  | "DIALING"
  | "RINGING"
  | "IVR_MENU"
  | "ON_HOLD"
  | "HUMAN"
  | "VOICEMAIL"
  | "DEAD";

export type Classification = {
  state: CallState;
  /** Menu/greeting transcript when available (feeds the IVR navigator). */
  transcript?: string;
};

/**
 * CallStateClassifier — consumes the media stream and labels each moment.
 *
 * The stub here maps the simulated audio labels directly and applies a keyword
 * heuristic to distinguish an IVR menu from a live human when only a transcript
 * is available. A production classifier swaps in AMD (human/machine) + Vosk/
 * Whisper streaming STT + hold-music detection behind the same interface.
 */
export interface CallStateClassifier {
  classify(event: MediaEvent): Classification | null;
}

const IVR_HINTS =
  /\b(press|marque|for (sales|support|billing|an operator)|menu|main menu|dial|extension|thank you for calling)\b/i;

const HUMAN_HINTS =
  /\b(hello|hi|this is|speaking|how can I help|good (morning|afternoon|evening)|thanks for holding)\b/i;

const VOICEMAIL_HINTS =
  /\b(voicemail|leave a message|not available|after the (tone|beep)|record your message)\b/i;

export class HeuristicClassifier implements CallStateClassifier {
  classify(event: MediaEvent): Classification | null {
    if (event.type === "ringing") return { state: "RINGING" };
    if (event.type === "hangup") return { state: "DEAD" };

    // event.type === "audio"
    const t = event.transcript ?? "";
    switch (event.label) {
      case "ivr_menu":
        return { state: "IVR_MENU", transcript: t };
      case "hold_music":
        return { state: "ON_HOLD" };
      case "voicemail_greeting":
        return { state: "VOICEMAIL", transcript: t };
      case "human_greeting":
        return { state: "HUMAN", transcript: t };
      case "silence":
        return { state: "DEAD" };
    }

    // Fallback when only a transcript is present (e.g. real STT with no label):
    // resolve ambiguity by keyword priority — voicemail, then IVR, then human.
    if (VOICEMAIL_HINTS.test(t)) return { state: "VOICEMAIL", transcript: t };
    if (IVR_HINTS.test(t)) return { state: "IVR_MENU", transcript: t };
    if (HUMAN_HINTS.test(t)) return { state: "HUMAN", transcript: t };
    return null;
  }
}
