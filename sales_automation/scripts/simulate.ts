import { config } from "dotenv";
config();

import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  campaigns,
  reps,
  leads,
  callAttempts,
  ivrMenuMaps,
  suppressionList,
} from "../src/db/schema";
import {
  SimulatedTelephonyProvider,
  SCENARIOS,
  type Scenario,
} from "../src/lib/telephony/simulated";
import { runCampaignDialer, resetRepsAvailable } from "../src/lib/dialer/engine";
import { checkDialable } from "../src/lib/compliance/predial";
import { campaignMetrics } from "../src/lib/observability/metrics";
import { chooseDigit, recordOutcome } from "../src/lib/ivr/navigator";
import { abandonmentRate } from "../src/lib/dialer/abandonment";

const FROM = "+15550000000";

// Map each test destination to a call scenario.
const SCENARIO_BY_NUMBER: Record<string, Scenario> = {
  "+14045550001": SCENARIOS.straightHuman,
  "+14045550002": SCENARIOS.ivrThenHuman,
  "+14045550003": SCENARIOS.holdThenHuman,
  "+14045550004": SCENARIOS.voicemail,
  "+14045550005": SCENARIOS.dead,
  "+14045550006": SCENARIOS.straightHuman,
  "+14045550007": SCENARIOS.ivrThenHuman,
  "+14045550008": SCENARIOS.straightHuman,
};

function scenarioFor(to: string): Scenario {
  return SCENARIO_BY_NUMBER[to] ?? SCENARIOS.straightHuman;
}

async function freshCampaign(name: string, overdial = "1.0") {
  const [c] = await db
    .insert(campaigns)
    .values({
      name,
      status: "active",
      callingHoursStart: 0, // full-day so the time gate never blocks during tests
      callingHoursEnd: 24,
      overdialRatio: overdial,
      perLeadDailyCap: 3,
      cooldownMinutes: 0,
      repRingTimeoutSeconds: 3,
      maxHoldSeconds: 480,
      maxIvrLevels: 6,
    })
    .returning();
  return c;
}

async function addLead(campaignId: string, phone: string, name: string, tz = "America/New_York") {
  const [l] = await db
    .insert(leads)
    .values({
      phone,
      name,
      company: `${name} Co`,
      timezone: tz,
      source: "sim",
      consentBasis: "written opt-in",
      consentBasisType: "express_written",
      consentStatus: "has_basis",
      dncStatus: "clear",
      validationStatus: "eligible",
      campaignId,
      rawSourceRow: { notes: `sim note for ${name}` },
    })
    .returning();
  return l;
}

async function cleanup() {
  await db.delete(callAttempts);
  await db.delete(ivrMenuMaps);
  await db.delete(reps);
  await db.delete(leads).where(inArray(leads.source, ["sim"]));
  await db.delete(campaigns);
  await db
    .delete(suppressionList)
    .where(eq(suppressionList.reason, "sim-optout"));
}

function ms(n: number | null) {
  return n == null ? "-" : `${n}ms`;
}

async function partA() {
  console.log("\n═══ PART A: full campaign run (governor caps concurrency at freeReps) ═══");
  const c = await freshCampaign("Sim Campaign A");
  await db.insert(reps).values([
    { name: "Rep One", phone: "+15551110001", presence: "available", campaignId: c.id },
    { name: "Rep Two", phone: "+15551110002", presence: "available", campaignId: c.id },
  ]);
  const nums = Object.keys(SCENARIO_BY_NUMBER);
  for (let i = 0; i < nums.length; i++) {
    await addLead(c.id, nums[i], `LeadA${i + 1}`);
  }
  console.log(`2 reps, ${nums.length} leads. cap = freeReps * 1.0 = 2 concurrent dials.`);

  const provider = new SimulatedTelephonyProvider({
    scenarioFor,
    repAnswerProbability: 1.0,
    repAnswerLatencyMs: 100,
    timeScale: 0.3,
    seed: 42,
  });
  const res = await runCampaignDialer({
    provider,
    campaignId: c.id,
    fromNumber: FROM,
    talkTimeMs: 30,
  });

  console.log(`\nreleased=${res.released} blockedByGate=${res.blockedByGate}`);
  console.log("Outcomes:");
  for (const o of res.outcomes.sort((a, b) => a.leadId.localeCompare(b.leadId))) {
    const states = o.timeline.map((t) => t.state).join(" → ");
    console.log(
      `  ${o.finalState.padEnd(10)} human=${o.reachedHuman ? "Y" : "n"} bridged=${o.bridged ? "Y" : "n"} tth=${ms(o.timeToHumanMs)}  [${states}]`,
    );
  }
  const m = await campaignMetrics(c.id, 60);
  console.log("\nMetrics:", {
    dials: m.dials,
    humanReachRate: m.humanReachRate.toFixed(2),
    repAnswerRate: m.repAnswerRate.toFixed(2),
    avgTimeToHumanMs: m.avgTimeToHumanMs,
    abandonmentRate30d: m.abandonmentRate30d.toFixed(3),
  });
  return c.id;
}

async function partB() {
  console.log("\n═══ PART B: pre-dial compliance gate blocks ═══");
  const c = await freshCampaign("Sim Campaign B");
  const okLead = await addLead(c.id, "+14045559100", "GoodLead");
  const noTz = await addLead(c.id, "+14045559101", "NoTimezone", "");
  await db.update(leads).set({ timezone: null }).where(eq(leads.id, noTz.id));
  const suppressed = await addLead(c.id, "+14045559102", "Suppressed");
  await db
    .insert(suppressionList)
    .values({ phone: "+14045559102", reason: "sim-optout" });

  const campaign = (await db.select().from(campaigns).where(eq(campaigns.id, c.id)))[0];
  for (const [label, id] of [
    ["valid lead", okLead.id],
    ["null timezone", noTz.id],
    ["suppressed number", suppressed.id],
  ] as const) {
    const [lead] = await db.select().from(leads).where(eq(leads.id, id));
    const d = await checkDialable(lead, campaign);
    console.log(
      `  ${label.padEnd(18)} → ${d.allowed ? "ALLOWED" : "BLOCKED"}${d.failedCheck ? ` (${d.failedCheck}: ${d.reason})` : ""}`,
    );
  }
}

async function partC() {
  console.log("\n═══ PART C: IVR menu-map learning (choice stabilizes over repeats) ═══");
  const dest = "+18005551234";
  const transcript =
    "Thank you for calling. For billing press 2, for sales press 1, for an operator press 0.";

  // First call: cold-start heuristic.
  const first = await chooseDigit(dest, transcript);
  console.log(`  call 1 (cold): digit=${first.digit} — ${first.reason}`);

  // Simulate a few calls where digit 1 reaches a human, reinforcing the map.
  for (let i = 0; i < 4; i++) {
    const ch = await chooseDigit(dest, transcript);
    await recordOutcome({
      destination: dest,
      fingerprint: ch.fingerprint,
      digit: ch.digit,
      reachedHuman: true,
      timeToHumanMs: 4000,
    });
  }
  const learned = await chooseDigit(dest, transcript);
  console.log(`  call 6 (learned): digit=${learned.digit} — ${learned.reason}`);
}

async function partD() {
  console.log("\n═══ PART D: abandonment tightens OVERDIAL_RATIO ═══");
  const c = await freshCampaign("Sim Campaign D", "1.0");
  await db.insert(reps).values([
    { name: "Rep D1", phone: "+15551110003", presence: "available", campaignId: c.id },
    { name: "Rep D2", phone: "+15551110004", presence: "available", campaignId: c.id },
  ]);
  // All straight-to-human, but reps NEVER answer → every reached-human abandons.
  for (let i = 0; i < 6; i++) {
    await addLead(c.id, `+1404556${(9200 + i).toString()}`, `LeadD${i + 1}`);
  }
  await resetRepsAvailable(c.id);
  const provider = new SimulatedTelephonyProvider({
    scenarioFor: () => SCENARIOS.straightHuman,
    repAnswerProbability: 0, // no rep ever answers
    timeScale: 0.2,
    seed: 7,
  });
  const res = await runCampaignDialer({
    provider,
    campaignId: c.id,
    fromNumber: FROM,
    talkTimeMs: 10,
  });
  const { reachedHuman, abandoned, rate } = await abandonmentRate(c.id);
  console.log(
    `  reachedHuman=${reachedHuman} abandoned=${abandoned} rate=${(rate * 100).toFixed(0)}%`,
  );
  console.log(
    `  OVERDIAL_RATIO auto-tightened from 1.0 → ${res.finalOverdialRatio} (FCC ≤3% guard)`,
  );
}

async function main() {
  await cleanup();
  await partA();
  await partB();
  await partC();
  await partD();
  console.log("\n✓ Simulation complete.\n");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
