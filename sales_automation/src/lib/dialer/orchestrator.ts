import { eq } from "drizzle-orm";
import { db } from "@/db";
import { callAttempts, leadActivities } from "@/db/schema";
import type { TelephonyProvider } from "@/lib/telephony/provider";
import { HeuristicClassifier, type CallState } from "@/lib/classifier";
import { chooseDigit, recordOutcome } from "@/lib/ivr/navigator";
import { completePendingCallFollowUps } from "@/lib/pipeline/service";
import { startRepRing, confirmBridge, type RepRingHandle } from "./handoff";
import { dialerBus } from "./events";
import { writeLeadResult } from "@/lib/sheets/writeback";
import { resultLabelFor } from "@/lib/config";

/**
 * Per-call state machine (spec §3). Runs one outbound call end to end:
 *
 *   DIALING → on ANSWER, pre-ring a rep into the conference (in parallel with
 *             the classification below, so the rep is parked and waiting) →
 *     classify each media moment →
 *     IVR_MENU  → navigator picks a digit, inject via DTMF (no audio)
 *     ON_HOLD   → stay silent, enforce max-hold timeout
 *     VOICEMAIL → release the parked rep, hang up (no VM drop)
 *     HUMAN     → confirm the bridge — rep is already there, ~0 wait (§5)
 *     DEAD      → release the parked rep, mark disposition
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
      phone: lead.phone,
      leadId: lead.id,
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

  // Pre-ring: started the instant the lead answers so a rep is parked in the
  // conference by the time a human is confirmed. Lazily started (whichever of the
  // "answered" event or a HUMAN classification lands first kicks it off).
  let ringHandle: RepRingHandle | null = null;
  const ensureRing = async (): Promise<RepRingHandle> => {
    if (!ringHandle) {
      ringHandle = await startRepRing({
        provider,
        callId: handle.callId,
        campaignId: campaign.id,
        leadId: lead.id,
        ringTimeoutSeconds: campaign.repRingTimeoutSeconds,
      });
    }
    return ringHandle;
  };
  // Release a parked rep when the call ends up not being a live human.
  const releaseParkedRep = async () => {
    if (ringHandle) await ringHandle.release();
  };

  for await (const event of handle.events) {
    // Lead answered: pre-ring a rep NOW, in parallel with the classification
    // below. The rep joins the silent conference and waits — so a HUMAN result
    // bridges instantly instead of making the customer wait through a fresh dial.
    if (event.type === "answered") {
      record("ANSWERED");
      await ensureRing();
      continue;
    }

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
        await releaseParkedRep();
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
        await releaseParkedRep();
        await provider.hangup(handle.callId);
        break;
      }
      continue;
    }

    if (c.state === "VOICEMAIL") {
      record("VOICEMAIL");
      outcome.finalState = "VOICEMAIL";
      outcome.disposition = "voicemail";
      await releaseParkedRep(); // free the parked rep — it wasn't a live human
      await provider.hangup(handle.callId); // no VM drop (out of scope)
      break;
    }

    if (c.state === "HUMAN") {
      record("HUMAN");
      timeToHumanMs = Date.now() - startedAt;
      outcome.reachedHuman = true;
      outcome.timeToHumanMs = timeToHumanMs;

      // The rep was pre-rung at answer; wait on that (usually already parked).
      // If AMD confirmed HUMAN before the "answered" event landed, start now.
      const ring = await ensureRing();
      const winner = await ring.winner;

      if (winner) {
        const bridged = await confirmBridge({
          provider,
          callId: handle.callId,
          campaignId: campaign.id,
          leadId: lead.id,
          repId: winner.repId,
          lead: ring.lead,
        });
        record("BRIDGED");
        outcome.finalState = "BRIDGED";
        outcome.bridged = true;
        outcome.repId = bridged.repId;
        outcome.attemptId = bridged.attemptId;
        outcome.disposition = "bridged_to_rep";
      } else {
        record("ABANDONED");
        outcome.finalState = "ABANDONED";
        outcome.abandoned = true;
        outcome.disposition = "abandoned_no_rep";
        await releaseParkedRep();
        await provider.hangup(handle.callId);
      }
      break;
    }

    if (c.state === "DEAD") {
      record("DEAD");
      outcome.finalState = "DEAD";
      await releaseParkedRep(); // lead hung up — don't strand a parked rep
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
    // Non-bridged outcome: INSERT the attempt and append a `system` timeline
    // bubble (spec §6). Bridged calls (outcome.attemptId set) get their activity
    // from the console finalize instead, so no double bubble.
    const [inserted] = await db
      .insert(callAttempts)
      .values({
        leadId: lead.id,
        campaignId: campaign.id,
        phone: lead.phone,
        repId: outcome.repId,
        disposition: outcome.disposition,
        ...finalValues,
      })
      .returning({ id: callAttempts.id });

    await db.insert(leadActivities).values({
      leadId: lead.id,
      callAttemptId: inserted.id,
      kind: "system",
      body: systemActivityBody(outcome.disposition),
      meta: { disposition: outcome.disposition, finalState: outcome.finalState },
    });

    // Spend the due `call` follow-up that authorized this re-dial past the
    // `already_contacted` dedupe gate. The console never finalizes a non-bridged
    // dialer call, so if we don't mark it done here the follow-up stays pending
    // + due and re-authorizes the dial on every subsequent run. Mirrors the
    // console's finalize spend for bridged calls (console/calls/route.ts).
    await completePendingCallFollowUps(lead.id);

    // Closed loop: write this machine outcome back to the lead's Google-Sheet row
    // (no-op for non-sheet leads; best-effort — never throws). Bridged calls are
    // written from the console instead, once the rep picks a disposition.
    const resultLabel = resultLabelFor(outcome.disposition);
    if (resultLabel) {
      await writeLeadResult(
        lead.id,
        resultLabel,
        systemActivityBody(outcome.disposition),
      );
    }
  }

  return outcome;
}

/** Human-readable dialer bubble text for a non-bridged machine disposition. */
function systemActivityBody(disposition: string): string {
  const map: Record<string, string> = {
    no_answer: "Dialer: no answer",
    voicemail: "Dialer: reached voicemail",
    ivr_giveup: "Dialer: gave up navigating the IVR menu",
    hold_timeout: "Dialer: hold timed out",
    abandoned_no_rep: "Dialer: reached a human but no rep was available",
  };
  return map[disposition] ?? `Dialer: ${disposition}`;
}
