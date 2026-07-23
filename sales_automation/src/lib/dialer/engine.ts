import { eq } from "drizzle-orm";
import { db } from "@/db";
import { leads as leadsTable } from "@/db/schema";
import { recordCalled } from "@/lib/pipeline/ledger";
import type { TelephonyProvider } from "@/lib/telephony/provider";
import {
  getCampaign,
  listCampaignLeads,
  listFreeReps,
  setRepOnCall,
} from "@/lib/campaigns/service";
import { checkDialable } from "@/lib/compliance/predial";
import { abandonmentRate, suggestOverdialRatio } from "./abandonment";
import { InMemoryGovernor } from "./governor";
import { runCall, type CallOutcome } from "./orchestrator";
import { dialerBus } from "./events";

/**
 * Campaign dialer engine (spec §2 + §3). Pulls eligible leads, runs each through
 * the pre-dial compliance gate, and releases dials only within the governor's
 * cap (freeReps * OVERDIAL_RATIO). Each released dial runs the per-call state
 * machine; the abandonment tracker continuously re-tunes OVERDIAL_RATIO.
 */

export type EngineResult = {
  released: number;
  blockedByGate: number;
  outcomes: CallOutcome[];
  finalOverdialRatio: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runCampaignDialer(params: {
  provider: TelephonyProvider;
  campaignId: string;
  fromNumber: string;
  /** Simulated rep talk-time before a bridged rep frees up again (ms). */
  talkTimeMs?: number;
  maxLeads?: number;
}): Promise<EngineResult> {
  const { provider, campaignId, fromNumber, talkTimeMs = 50 } = params;
  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new Error(`campaign ${campaignId} not found`);

  // Real-time queue: pull eligible campaign leads not already queued this run.
  // Called at start and whenever the in-memory queue drains, so leads the sheet
  // ingester adds mid-run are dialed in the same run without a restart. Re-dialing
  // is prevented by checkDialable + the contact ledger (the dedupe authority), so
  // re-querying already-seen ids is safe — we just skip them via `seen`.
  const maxDials = params.maxLeads ?? Infinity;
  const seen = new Set<string>();
  const queue: Awaited<ReturnType<typeof listCampaignLeads>> = [];
  const refill = async () => {
    for (const l of await listCampaignLeads(campaignId)) {
      if (!seen.has(l.id)) {
        seen.add(l.id);
        queue.push(l);
      }
    }
  };
  await refill();

  let ratio = parseFloat(campaign.overdialRatio) || 1.0;
  const governor = new InMemoryGovernor(ratio);
  const outcomes: CallOutcome[] = [];
  let released = 0;
  let blockedByGate = 0;
  const inFlight = new Map<number, Promise<void>>();
  let seq = 0;

  const campaignCfg = {
    id: campaign.id,
    maxHoldSeconds: campaign.maxHoldSeconds,
    maxIvrLevels: campaign.maxIvrLevels,
    repRingTimeoutSeconds: campaign.repRingTimeoutSeconds,
  };

  dialerBus.publish({
    type: "batch_started",
    campaignId,
    queued: queue.length,
    at: new Date().toISOString(),
  });

  while (queue.length > 0 || inFlight.size > 0) {
    // Refresh governor inputs each cycle.
    const free = (await listFreeReps(campaignId)).length;
    governor.setFreeReps(free);
    const { rate } = await abandonmentRate(campaignId);
    ratio = suggestOverdialRatio(rate, ratio);
    governor.setOverdialRatio(ratio);

    const snap = governor.snapshot();
    dialerBus.publish({
      type: "governor",
      campaignId,
      freeReps: snap.freeReps,
      overdialRatio: snap.overdialRatio,
      activeDials: snap.activeDials,
      cap: snap.cap,
      at: new Date().toISOString(),
    });

    let slots = governor.releasableSlots();

    while (slots > 0 && queue.length > 0 && released < maxDials) {
      const lead = queue.shift()!;
      if (!lead.phone) continue;

      const decision = await checkDialable(lead, campaign);
      if (!decision.allowed) {
        blockedByGate++;
        continue; // a blocked dial never leaves the queue; no slot consumed
      }

      governor.onDialStarted();
      // Guaranteed dial-release moment: stamp the persistent "called" ledger
      // (dedupe across sessions) and the lead's lastContacted (spec §2/§6).
      await recordCalled(lead.phone, lead.id);
      await db
        .update(leadsTable)
        .set({ lastContacted: new Date() })
        .where(eq(leadsTable.id, lead.id));
      slots--;
      released++;
      const key = seq++;
      const p = runCall({
        provider,
        lead: { id: lead.id, phone: lead.phone, campaignId },
        campaign: campaignCfg,
        fromNumber,
      })
        .then(async (outcome) => {
          outcomes.push(outcome);
          governor.onDialEnded();
          // A bridged rep is busy for the conversation, then frees up.
          if (outcome.bridged && outcome.repId) {
            await sleep(talkTimeMs);
            await setRepOnCall(outcome.repId, false);
          }
        })
        .finally(() => {
          inFlight.delete(key);
        });
      inFlight.set(key, p);
    }

    // Drained the in-memory queue — try to pick up leads added since (e.g. by the
    // sheet poller mid-run) before idling or exiting the run.
    if (queue.length === 0 && released < maxDials) await refill();

    // Backpressure: reps saturated and nothing to react to → brief wait.
    if (inFlight.size === 0 && governor.releasableSlots() <= 0 && queue.length > 0) {
      await sleep(20);
      continue;
    }
    // Wait for at least one in-flight call to settle before re-evaluating.
    if (inFlight.size > 0) {
      await Promise.race(inFlight.values());
    }
  }

  dialerBus.publish({
    type: "batch_finished",
    campaignId,
    released,
    blockedByGate,
    reachedHuman: outcomes.filter((o) => o.reachedHuman).length,
    bridged: outcomes.filter((o) => o.bridged).length,
    at: new Date().toISOString(),
  });

  return { released, blockedByGate, outcomes, finalOverdialRatio: ratio };
}
