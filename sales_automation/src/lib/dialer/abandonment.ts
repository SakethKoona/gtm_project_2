import { and, count, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { callAttempts } from "@/db/schema";

/**
 * Abandonment tracker (spec §6). FCC target: ≤3% abandoned calls.
 *
 * An "abandoned" call = a live human was reached but no rep answered within the
 * ring timeout. We compute a rolling 30-day per-campaign rate and, as it
 * approaches the 3% threshold, tighten OVERDIAL_RATIO so fewer dials than free
 * reps are released — trading throughput for compliance.
 */

export const FCC_ABANDONMENT_LIMIT = 0.03;

export async function abandonmentRate(
  campaignId: string,
  windowDays = 30,
): Promise<{ reachedHuman: number; abandoned: number; rate: number }> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const [{ reached } = { reached: 0 }] = await db
    .select({ reached: count() })
    .from(callAttempts)
    .where(
      and(
        eq(callAttempts.campaignId, campaignId),
        eq(callAttempts.reachedHuman, true),
        gte(callAttempts.startedAt, since),
      ),
    );

  const [{ abandoned } = { abandoned: 0 }] = await db
    .select({ abandoned: count() })
    .from(callAttempts)
    .where(
      and(
        eq(callAttempts.campaignId, campaignId),
        eq(callAttempts.abandoned, true),
        gte(callAttempts.startedAt, since),
      ),
    );

  const rate = reached > 0 ? abandoned / reached : 0;
  return { reachedHuman: reached, abandoned, rate };
}

/**
 * Suggest an overdial ratio given the current abandonment rate. Above 2/3 of the
 * FCC limit we start pulling the ratio below 1.0; at/over the limit we clamp
 * hard to 0.5 so pending live connections stay well under free-rep capacity.
 */
export function suggestOverdialRatio(rate: number, current: number): number {
  if (rate >= FCC_ABANDONMENT_LIMIT) return Math.min(current, 0.5);
  if (rate >= (FCC_ABANDONMENT_LIMIT * 2) / 3) return Math.min(current, 0.8);
  // Comfortably under the limit: allow drifting back toward 1.0.
  return Math.min(1.0, current + 0.05);
}
