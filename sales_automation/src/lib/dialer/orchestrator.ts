import { eq } from "drizzle-orm";
import { db } from "@/db";
import { callAttempts } from "@/db/schema";
import type { TelephonyProvider } from "@/lib/telephony/provider";
import { HeuristicClassifier, type CallState } from "@/lib/classifier";
import { chooseDigit, recordOutcome } from "@/lib/ivr/navigator";
import { handoff } from "./handoff";
import { dialerBus } from "./events";

/**
 * Per-call state machine (spec §3). Runs one outbound call end to end:
 *
 *   DIALING → on answer, classify each media moment →
 *     IVR_MENU  → navigator picks a digit, inject via DTMF (no audio)
 *     ON_HOLD   → stay silent, enforce max-hold timeout
 *     VOICEMAIL → hang up, mark disposition (no VM drop)
 *     HUMAN     → hand off immediately (§5)
 *     DEAD      → mark disposition, release
 *
 * The lead never hears synthesized audio — only DTMF and silence. Records a
 * full timeline + outcome to call_attempts for observability + abandonment.
 */

export type CallOutcome = {
  callId: string;
  leadId: string;
  finalState: CallState | "BRIDGED" | "ABANDONED";
  reachedHuman: boolean;
  bridged: boolean;
  abandoned: boolean;
  repId: string | null;
  /** call_attempts row id created at bridge time (null for non-bridged calls). */
  attemptId: string | null;
  disposition: string;
  timeToHumanMs: number | null;
  holdMs: number;
  timeline: { state: string; at: string }[];
};

type RunParams = {
  provider: TelephonyProvider;
  lead: { id: string; phone: string; campaignId: string };
  campaign: {
    id: string;
    maxHoldSeconds: number;
    maxIvrLevels: number;
    repRingTimeoutSeconds: number;
  };
  fromNumber: string;
};

export async function runCall(params: RunParams): Promise<CallOutcome> {
  const { provider, lead, campaign, fromNumber } = params;
  const classifier = new HeuristicClassifier();
  const startedAt = Date.now();
  const timeline: { state: string; at: string }[] = [];
  let callId = "pending";
  const record = (state: string) => {
    timeline.push({ state, at: new Date().toISOString() });
    dialerBus.publish({
      type: "call_state",
      callId,
      campaignId: campaign.id,
      state,
      at: new Date().toISOString(),
    });
  };

  const ivrDecisions: { destination: string; fingerprint: string; digit: string }[] =
    [];
  let ivrLevels = 0;
  let holdStart: number | null = null;
  let holdMs = 0;
  let timeToHumanMs: number | null = null;

  record("DIALING");
  const handle = await provider.placeCall(lead.phone, fromNumber);
  callId = handle.callId;

  const outcome: CallOutcome = {
    callId: handle.callId,
    leadId: lead.id,
    finalState: "DEAD",
    reachedHuman: false,
    bridged: false,
    abandoned: false,
    repId: null,
    attemptId: null,
    disposition: "no_answer",
    timeToHumanMs: null,
    holdMs: 0,
    timeline,
  };

  for await (const event of handle.events) {
    const c = classifier.classify(event);
    if (!c) continue;

    // Close out any hold interval when state leaves ON_HOLD.
    if (c.state !== "ON_HOLD" && holdStart != null) {
      holdMs += Date.now() - holdStart;
      holdStart = null;
    }

    if (c.state === "RINGING") {
      record("RINGING");
      continue;
    }

    if (c.state === "IVR_MENU") {
      record("IVR_MENU");
      ivrLevels++;
      if (ivrLevels > campaign.maxIvrLevels) {
        // Guard against infinite menu trees — bail out.
        outcome.finalState = "DEAD";
        outcome.disposition = "ivr_giveup";
        await provider.hangup(handle.callId);
        break;
      }
      const choice = await chooseDigit(lead.phone, c.transcript ?? "");
      ivrDecisions.push({
        destination: lead.phone,
        fingerprint: choice.fingerprint,
        digit: choice.digit,
      });
      await provider.sendDigits(handle.callId, choice.digit);
      continue;
    }

    if (c.state === "ON_HOLD") {
      record("ON_HOLD");
      if (holdStart == null) holdStart = Date.now();
      // Enforce max-hold timeout.
      if (holdMs + (Date.now() - holdStart) > campaign.maxHoldSeconds * 1000) {
        outcome.finalState = "DEAD";
        outcome.disposition = "hold_timeout";
        await provider.hangup(handle.callId);
        break;
      }
      continue;
    }

    if (c.state === "VOICEMAIL") {
      record("VOICEMAIL");
      outcome.finalState = "VOICEMAIL";
      outcome.disposition = "voicemail";
      await provider.hangup(handle.callId); // no VM drop (out of scope)
      break;
    }

    if (c.state === "HUMAN") {
      record("HUMAN");
      timeToHumanMs = Date.now() - startedAt;
      outcome.reachedHuman = true;
      outcome.timeToHumanMs = timeToHumanMs;

      const result = await handoff({
        provider,
        callId: handle.callId,
        campaignId: campaign.id,
        leadId: lead.id,
        ringTimeoutSeconds: campaign.repRingTimeoutSeconds,
      });

      if (result.outcome === "bridged") {
        record("BRIDGED");
        outcome.finalState = "BRIDGED";
        outcome.bridged = true;
        outcome.repId = result.repId;
        outcome.attemptId = result.attemptId;
        outcome.disposition = "bridged_to_rep";
      } else {
        record("ABANDONED");
        outcome.finalState = "ABANDONED";
        outcome.abandoned = true;
        outcome.disposition = "abandoned_no_rep";
        await provider.hangup(handle.callId);
      }
      break;
    }

    if (c.state === "DEAD") {
      record("DEAD");
      outcome.finalState = "DEAD";
      break;
    }
  }

  if (holdStart != null) holdMs += Date.now() - holdStart;
  outcome.holdMs = holdMs;

  // Reinforce the IVR menu map with what actually happened.
  for (const d of ivrDecisions) {
    await recordOutcome({
      destination: d.destination,
      fingerprint: d.fingerprint,
      digit: d.digit,
      reachedHuman: outcome.reachedHuman,
      timeToHumanMs: timeToHumanMs ?? undefined,
    });
  }

  // Persist the attempt for metrics + abandonment tracking. Bridged calls already
  // have a row (created at hand-off so the rep console could reference it) — UPDATE
  // it with the full timeline; the console later adds the rep's conversation
  // breakdown + final disposition. Non-bridged calls INSERT fresh.
  const finalValues = {
    finalState: outcome.finalState as CallState | "BRIDGED" | "ABANDONED",
    reachedHuman: outcome.reachedHuman,
    bridged: outcome.bridged,
    abandoned: outcome.abandoned,
    timeToHumanMs: outcome.timeToHumanMs,
    holdMs: outcome.holdMs,
    timeline: outcome.timeline,
    endedAt: new Date(),
  };
  if (outcome.attemptId) {
    await db
      .update(callAttempts)
      .set(finalValues)
      .where(eq(callAttempts.id, outcome.attemptId));
  } else {
    await db.insert(callAttempts).values({
      leadId: lead.id,
      campaignId: campaign.id,
      phone: lead.phone,
      repId: outcome.repId,
      disposition: outcome.disposition,
      ...finalValues,
    });
  }

  return outcome;
}
