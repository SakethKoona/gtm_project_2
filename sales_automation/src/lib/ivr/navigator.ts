import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { ivrMenuMaps } from "@/db/schema";

/**
 * IVR navigator (spec §4). Goal: reach a live human as fast as possible.
 *
 * Two signals combine:
 *  1. Cold-start heuristic — parse "press N for X" options from the menu
 *     transcript and score each digit by how strongly X matches human-reaching
 *     keywords (representative/agent/operator/sales/new customer).
 *  2. Learned menu map — per (destination, prompt fingerprint) we track how
 *     often each digit reached a human and how fast, and reinforce the winner.
 *
 * The learned signal overrides the heuristic once there's enough evidence.
 */

const HUMAN_KEYWORDS: { re: RegExp; weight: number }[] = [
  { re: /\b(representative|agent|operator)\b/i, weight: 5 },
  { re: /\bsales\b/i, weight: 4 },
  { re: /\bnew customer\b/i, weight: 4 },
  { re: /\b(speak|talk) (to|with)\b/i, weight: 3 },
  { re: /\bcustomer service\b/i, weight: 2 },
  { re: /\bsupport\b/i, weight: 1 },
];

export function fingerprint(transcript: string): string {
  const norm = transcript.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  return createHash("sha1").update(norm).digest("hex").slice(0, 16);
}

/** Extract {digit → description} options from a menu transcript. */
export function parseMenuOptions(transcript: string): Map<string, string> {
  const options = new Map<string, string>();
  // "for sales press 1"  |  "press 1 for sales"  |  "1 for sales"
  const patterns = [
    /for ([^,.;]+?)[,.]?\s*(?:press|dial|marque)\s*(\d|zero|star|pound)/gi,
    /(?:press|dial|marque)\s*(\d|zero|star|pound)\s*for ([^,.;]+)/gi,
  ];
  const toDigit = (s: string) =>
    ({ zero: "0", star: "*", pound: "#" })[s.toLowerCase()] ?? s;

  for (const [, a, b] of transcript.matchAll(patterns[0])) {
    options.set(toDigit(b), a.trim());
  }
  for (const [, d, desc] of transcript.matchAll(patterns[1])) {
    if (!options.has(toDigit(d))) options.set(toDigit(d), desc.trim());
  }
  return options;
}

function scoreDescription(desc: string): number {
  let score = 0;
  for (const { re, weight } of HUMAN_KEYWORDS) if (re.test(desc)) score += weight;
  return score;
}

export type DigitChoice = {
  digit: string;
  reason: string;
  fingerprint: string;
};

const MIN_ATTEMPTS_TO_TRUST_MAP = 3;

export async function chooseDigit(
  destination: string,
  transcript: string,
): Promise<DigitChoice> {
  const fp = fingerprint(transcript);
  const options = parseMenuOptions(transcript);

  // 1. Learned map: best historical digit for this exact prompt.
  const learned = await db
    .select()
    .from(ivrMenuMaps)
    .where(
      and(
        eq(ivrMenuMaps.destination, destination),
        eq(ivrMenuMaps.promptFingerprint, fp),
      ),
    );
  const trusted = learned
    .filter((r) => r.attemptCount >= MIN_ATTEMPTS_TO_TRUST_MAP)
    .map((r) => ({
      digit: r.digit,
      rate: r.reachedHumanCount / Math.max(1, r.attemptCount),
      avgMs: r.totalTimeToHumanMs / Math.max(1, r.reachedHumanCount || 1),
    }))
    .sort((a, b) => b.rate - a.rate || a.avgMs - b.avgMs);

  if (trusted.length > 0 && trusted[0].rate > 0) {
    return {
      digit: trusted[0].digit,
      reason: `learned: ${(trusted[0].rate * 100).toFixed(0)}% reach-human over history`,
      fingerprint: fp,
    };
  }

  // 2. Cold-start heuristic: highest human-keyword score among parsed options.
  if (options.size > 0) {
    const ranked = [...options.entries()]
      .map(([digit, desc]) => ({ digit, desc, score: scoreDescription(desc) }))
      .sort((a, b) => b.score - a.score);
    if (ranked[0].score > 0) {
      return {
        digit: ranked[0].digit,
        reason: `heuristic: "${ranked[0].desc}" (score ${ranked[0].score})`,
        fingerprint: fp,
      };
    }
  }

  // 3. Fallback: "0" for operator (or stay on the line).
  return { digit: "0", reason: "fallback: operator", fingerprint: fp };
}

/** Reinforce the map with the outcome of a digit choice. */
export async function recordOutcome(params: {
  destination: string;
  fingerprint: string;
  digit: string;
  reachedHuman: boolean;
  timeToHumanMs?: number;
}): Promise<void> {
  const { destination, fingerprint: fp, digit, reachedHuman } = params;
  await db
    .insert(ivrMenuMaps)
    .values({
      destination,
      promptFingerprint: fp,
      digit,
      attemptCount: 1,
      reachedHumanCount: reachedHuman ? 1 : 0,
      totalTimeToHumanMs: reachedHuman ? (params.timeToHumanMs ?? 0) : 0,
    })
    .onConflictDoUpdate({
      target: [
        ivrMenuMaps.destination,
        ivrMenuMaps.promptFingerprint,
        ivrMenuMaps.digit,
      ],
      set: {
        attemptCount: sql`${ivrMenuMaps.attemptCount} + 1`,
        reachedHumanCount: sql`${ivrMenuMaps.reachedHumanCount} + ${reachedHuman ? 1 : 0}`,
        totalTimeToHumanMs: sql`${ivrMenuMaps.totalTimeToHumanMs} + ${reachedHuman ? (params.timeToHumanMs ?? 0) : 0}`,
        updatedAt: sql`now()`,
      },
    });
}
