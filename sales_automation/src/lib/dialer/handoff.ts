import { eq } from "drizzle-orm";
import { db } from "@/db";
import { leads, callAttempts } from "@/db/schema";
import type { TelephonyProvider } from "@/lib/telephony/provider";
import {
  setRepOnCall,
  listFreeReps,
  repClientIdentity,
} from "@/lib/campaigns/service";
import { dialerBus } from "./events";

/**
 * Human-reached hand-off (spec §5), done in two phases so the rep can be staged
 * BEFORE a human is confirmed (drastically cutting the customer's silent wait):
 *
 *   1. `startRepRing` — the instant the lead answers, publish the screen-pop and
 *      ring every free rep into the lead's (silent) conference. This runs in
 *      PARALLEL with AMD / IVR navigation; it has no DB side effects. The winning
 *      rep is parked in the conference, waiting.
 *   2. `confirmBridge` — once a human is actually on the line, record the bridge
 *      (call_attempts row, rep-on-call, console call_bridged). The rep is already
 *      there, so this is instantaneous.
 *
 * If the call turns out not to be a human (voicemail/dead), the orchestrator
 * calls `provider.releaseReps` instead of `confirmBridge`, hanging up the parked
 * rep. A whisper is played into the winning rep's ear only — never toward the
 * lead. If no rep answers in time, the call is abandoned.
 */

type LeadRow = typeof leads.$inferSelect;

export type RepRingHandle = {
  /** Resolves when a rep answers & joins the conference, or null if none did. */
  winner: Promise<{ repId: string } | null>;
  lead: LeadRow | null;
  /**
   * Hang up any parked/ringing rep legs for this call and free the reserved rep.
   * Called when the call turns out not to be a live human.
   */
  release: () => Promise<void>;
};

/**
 * Phase 1: fire the screen-pop and start ringing free reps into the conference.
 * Returns immediately with a promise that resolves when a rep joins (or null).
 * No bridge / DB writes here — that's `confirmBridge`, gated on a real human.
 */
export async function startRepRing(params: {
  provider: TelephonyProvider;
  callId: string;
  campaignId: string;
  leadId: string;
  ringTimeoutSeconds: number;
}): Promise<RepRingHandle> {
  const { provider, callId, campaignId, leadId, ringTimeoutSeconds } = params;

  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
  const freeReps = await listFreeReps(campaignId);

  const noop = { winner: Promise.resolve(null), lead: lead ?? null, release: async () => {} };
  if (freeReps.length === 0) return noop;

  // Screen-pop fires the instant ringing starts — before anyone answers.
  if (lead) {
    dialerBus.publish({
      type: "screen_pop",
      callId,
      campaignId,
      lead: {
        id: lead.id,
        name: lead.name,
        company: lead.company,
        phone: lead.phone ?? "",
        source: lead.source,
        notes: (lead.rawSourceRow?.notes as string) ?? null,
      },
      at: new Date().toISOString(),
    });
  }

  const whisper = lead
    ? `Lead ${lead.name ?? "unknown"} from ${lead.company ?? "unknown company"}`
    : undefined;

  // Dial target per rep: browser reps ring their in-app softphone
  // (`client:rep_<userId>`), phone reps ring their number. Twilio's `to` accepts
  // both. Skip any rep without a valid target.
  const targets = freeReps
    .map((r) => {
      const to =
        r.kind === "browser"
          ? r.userId
            ? `client:${repClientIdentity(r.userId)}`
            : null
          : r.phone;
      return to ? { repId: r.id, phone: to } : null;
    })
    .filter((t): t is { repId: string; phone: string } => t !== null);

  if (targets.length === 0) return noop;

  // Kick off ringing but DON'T await — the caller keeps classifying the lead
  // audio while reps ring, then awaits `winner` when a human is confirmed.
  // Reserve the rep the instant they answer (onCall=true) so the engine can't
  // ring the same parked rep into a second call before the bridge is confirmed.
  let reservedRepId: string | null = null;
  const winner = provider
    .ringReps(callId, targets, ringTimeoutSeconds * 1000, whisper /* rep-ear only */)
    .then(async (w) => {
      if (w) {
        reservedRepId = w.repId;
        await setRepOnCall(w.repId, true);
      }
      return w;
    });

  const release = async () => {
    await provider.releaseReps(callId).catch(() => {});
    if (reservedRepId) await setRepOnCall(reservedRepId, false).catch(() => {});
  };

  return { winner, lead: lead ?? null, release };
}

export type BridgeResult = { repId: string; attemptId: string };

/**
 * Phase 2: a human is on the line and `repId` (from `startRepRing`) is parked in
 * the conference — record the bridge and cue the rep's console.
 */
export async function confirmBridge(params: {
  provider: TelephonyProvider;
  callId: string;
  campaignId: string;
  leadId: string;
  repId: string;
  lead: LeadRow | null;
}): Promise<BridgeResult> {
  const { provider, callId, campaignId, leadId, repId, lead } = params;

  await provider.bridge(callId, repId);
  await setRepOnCall(repId, true);

  // Create the call_attempts row now so the rep console has an id to finalize.
  // The orchestrator UPDATEs this same row at end-of-call with the full timeline.
  const [attempt] = await db
    .insert(callAttempts)
    .values({
      leadId,
      campaignId,
      phone: lead?.phone ?? "",
      repId,
      source: "dialer",
      reachedHuman: true,
      bridged: true,
      finalState: "BRIDGED",
    })
    .returning({ id: callAttempts.id });

  // Tell the winning rep's console: pin the lead + auto-start their timer.
  dialerBus.publish({
    type: "call_bridged",
    callId: attempt.id,
    repId,
    campaignId,
    lead: lead
      ? {
          id: lead.id,
          name: lead.name,
          company: lead.company,
          phone: lead.phone ?? "",
          notes: (lead.rawSourceRow?.notes as string) ?? null,
        }
      : null,
    at: new Date().toISOString(),
  });

  return { repId, attemptId: attempt.id };
}
