import { eq } from "drizzle-orm";
import { db } from "@/db";
import { leads, callAttempts } from "@/db/schema";
import type { TelephonyProvider } from "@/lib/telephony/provider";
import { setRepOnCall, listFreeReps } from "@/lib/campaigns/service";
import { dialerBus } from "./events";

/**
 * Human-reached hand-off (spec §5).
 *
 * The lead is connected to the system in silence. We ring all free reps
 * simultaneously; first to answer wins and is bridged. Lead context is pushed
 * out-of-band as a screen-pop the instant ringing starts. A whisper is played
 * into the winning rep's ear only — never toward the lead. If no rep answers in
 * time, the call is abandoned (counts against the governor).
 */

export type HandoffResult =
  | { outcome: "bridged"; repId: string; attemptId: string }
  | { outcome: "abandoned" };

export async function handoff(params: {
  provider: TelephonyProvider;
  callId: string;
  campaignId: string;
  leadId: string;
  ringTimeoutSeconds: number;
}): Promise<HandoffResult> {
  const { provider, callId, campaignId, leadId, ringTimeoutSeconds } = params;

  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
  const freeReps = await listFreeReps(campaignId);

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

  if (freeReps.length === 0) {
    return { outcome: "abandoned" };
  }

  const whisper = lead
    ? `Lead ${lead.name ?? "unknown"} from ${lead.company ?? "unknown company"}`
    : undefined;

  const answered = await provider.ringReps(
    callId,
    freeReps.map((r) => ({ repId: r.id, phone: r.phone })),
    ringTimeoutSeconds * 1000,
    whisper, // rep-ear only
  );

  if (!answered) {
    return { outcome: "abandoned" };
  }

  await provider.bridge(callId, answered.repId);
  await setRepOnCall(answered.repId, true);

  // Create the call_attempts row now so the rep console has an id to finalize.
  // The orchestrator UPDATEs this same row at end-of-call with the full timeline.
  const [attempt] = await db
    .insert(callAttempts)
    .values({
      leadId,
      campaignId,
      phone: lead?.phone ?? "",
      repId: answered.repId,
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
    repId: answered.repId,
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

  return { outcome: "bridged", repId: answered.repId, attemptId: attempt.id };
}
