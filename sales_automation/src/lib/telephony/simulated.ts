import { randomUUID } from "node:crypto";
import type {
  TelephonyProvider,
  OutboundHandle,
  MediaEvent,
  AudioLabel,
} from "./provider";

/**
 * A scripted call scenario: a sequence of media events with inter-event delays.
 * `expectDigit` on an ivr_menu event lets the sim advance only when the
 * navigator injects the "right" digit, so IVR navigation is genuinely exercised.
 */
export type ScenarioStep = {
  label: AudioLabel;
  transcript?: string;
  delayMs?: number;
  /** For ivr_menu steps: the digit that advances past this menu. */
  expectDigit?: string;
  /** Where a wrong digit lands the caller (default: repeat this menu). */
};

export type Scenario = {
  name: string;
  steps: ScenarioStep[];
};

export type SimConfig = {
  /** Resolve a destination number to a scenario. */
  scenarioFor: (to: string) => Scenario;
  /** Probability [0,1] a given rep answers when rung. Default 0.9. */
  repAnswerProbability?: number;
  /** How long a rep takes to answer, ms. Default 800. */
  repAnswerLatencyMs?: number;
  /** Deterministic RNG seed for reproducible sims. */
  seed?: number;
  /** Scale all delays (speed up sims). Default 1. */
  timeScale?: number;
};

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class SimulatedTelephonyProvider implements TelephonyProvider {
  private rng: () => number;
  private timeScale: number;
  private answerP: number;
  private answerLatency: number;
  // Per-call resolver for the digit the current IVR menu is awaiting. Registered
  // BEFORE the menu event is yielded, so a sendDigits() that races in right after
  // the consumer sees the menu is never missed.
  private digitResolvers = new Map<string, (digits: string) => void>();

  constructor(private cfg: SimConfig) {
    this.rng = mulberry32(cfg.seed ?? 1);
    this.timeScale = cfg.timeScale ?? 1;
    this.answerP = cfg.repAnswerProbability ?? 0.9;
    this.answerLatency = cfg.repAnswerLatencyMs ?? 800;
  }

  async placeCall(to: string): Promise<OutboundHandle> {
    const callId = randomUUID();
    const scenario = this.cfg.scenarioFor(to);
    // Capture only what the generator needs (no `this` aliasing).
    const timeScale = this.timeScale;
    const digitResolvers = this.digitResolvers;

    async function* gen(): AsyncGenerator<MediaEvent> {
      yield { type: "ringing" };
      await sleep(200 * timeScale);

      for (const step of scenario.steps) {
        await sleep((step.delayMs ?? 300) * timeScale);

        if (step.label === "ivr_menu" && step.expectDigit) {
          // Wait until the navigator sends the right digit before advancing.
          let advanced = false;
          while (!advanced) {
            // Register the resolver FIRST, then yield — avoids the race where
            // sendDigits arrives before we're listening.
            const digitPromise = new Promise<string>((resolve) => {
              digitResolvers.set(callId, resolve);
            });
            yield {
              type: "audio",
              label: "ivr_menu",
              transcript: step.transcript,
            };
            const digits = await digitPromise;
            digitResolvers.delete(callId);
            if (digits.includes(step.expectDigit)) advanced = true;
            else await sleep(400 * timeScale); // wrong digit → menu repeats
          }
          continue;
        }

        yield { type: "audio", label: step.label, transcript: step.transcript };
      }
      yield { type: "hangup" };
    }

    return { callId, events: gen() };
  }

  async sendDigits(callId: string, digits: string): Promise<void> {
    this.digitResolvers.get(callId)?.(digits);
  }

  async ringReps(
    _callId: string,
    repPhones: { repId: string; phone: string }[],
    timeoutMs: number,
    _whisper?: string,
  ): Promise<{ repId: string } | null> {
    if (repPhones.length === 0) return null;
    // Each rep independently may answer after a latency; first wins.
    const candidates = repPhones
      .filter(() => this.rng() < this.answerP)
      .map((r) => ({
        repId: r.repId,
        at: this.answerLatency * (0.5 + this.rng()),
      }))
      .filter((c) => c.at <= timeoutMs)
      .sort((a, b) => a.at - b.at);

    if (candidates.length === 0) {
      await sleep(Math.min(timeoutMs, 1500) * this.timeScale);
      return null;
    }
    await sleep(candidates[0].at * this.timeScale);
    return { repId: candidates[0].repId };
  }

  async bridge(_callId: string, _repId: string): Promise<void> {
    // In the sim, bridging is a no-op beyond state tracking done by the caller.
  }

  async hangup(callId: string): Promise<void> {
    this.digitResolvers.delete(callId);
  }
}

// ── Built-in scenario library (used by the simulation harness) ───────────────

export const SCENARIOS: Record<string, Scenario> = {
  straightHuman: {
    name: "straight to human",
    steps: [{ label: "human_greeting", transcript: "Hello, this is Pat.", delayMs: 500 }],
  },
  ivrThenHuman: {
    name: "one IVR menu then human",
    steps: [
      {
        label: "ivr_menu",
        transcript:
          "Thank you for calling. For sales press 1, for support press 2, for an operator press 0.",
        // Navigator prefers the operator digit (reaching any human is the goal);
        // pressing 0 routes to a person here.
        expectDigit: "0",
        delayMs: 600,
      },
      { label: "hold_music", delayMs: 500 },
      { label: "human_greeting", transcript: "Operator, one moment.", delayMs: 800 },
    ],
  },
  holdThenHuman: {
    name: "long hold then human",
    steps: [
      { label: "hold_music", delayMs: 400 },
      { label: "hold_music", delayMs: 400 },
      { label: "human_greeting", transcript: "Thanks for holding.", delayMs: 500 },
    ],
  },
  voicemail: {
    name: "voicemail",
    steps: [
      {
        label: "voicemail_greeting",
        transcript: "You've reached the voicemail of...",
        delayMs: 500,
      },
    ],
  },
  dead: {
    name: "no answer / dead air",
    steps: [{ label: "silence", delayMs: 400 }],
  },
};
