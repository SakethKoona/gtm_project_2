import { createHash } from "node:crypto";
import { SCENARIOS, type Scenario } from "./simulated";

/**
 * Deterministic scenario resolver for demos: hashes the destination number to a
 * realistic mix of outcomes (mostly reachable humans, some IVR/hold, a few
 * voicemail/dead). Same number always yields the same scenario, so repeated
 * calls to one destination reinforce its IVR menu map consistently.
 */
const MIX: { scenario: Scenario; weight: number }[] = [
  { scenario: SCENARIOS.straightHuman, weight: 40 },
  { scenario: SCENARIOS.ivrThenHuman, weight: 25 },
  { scenario: SCENARIOS.holdThenHuman, weight: 15 },
  { scenario: SCENARIOS.voicemail, weight: 12 },
  { scenario: SCENARIOS.dead, weight: 8 },
];
const TOTAL = MIX.reduce((s, m) => s + m.weight, 0);

export function scenarioForNumber(to: string): Scenario {
  const h = parseInt(createHash("sha1").update(to).digest("hex").slice(0, 8), 16);
  let bucket = h % TOTAL;
  for (const m of MIX) {
    if (bucket < m.weight) return m.scenario;
    bucket -= m.weight;
  }
  return SCENARIOS.straightHuman;
}
