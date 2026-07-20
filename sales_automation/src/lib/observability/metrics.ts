import { and, avg, count, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { callAttempts } from "@/db/schema";
import { abandonmentRate } from "@/lib/dialer/abandonment";

/**
 * Campaign metrics (spec §8): dials/min, human-reach rate, avg time-to-human,
 * abandonment rate, avg hold time, rep answer rate. Computed from call_attempts.
 */
export async function campaignMetrics(campaignId: string, windowMinutes = 60) {
  const since = new Date(Date.now() - windowMinutes * 60 * 1000);
  const scope = and(
    eq(callAttempts.campaignId, campaignId),
    gte(callAttempts.startedAt, since),
  );

  const [totals] = await db
    .select({
      dials: count(),
      reachedHuman: sql<number>`count(*) filter (where ${callAttempts.reachedHuman})`,
      bridged: sql<number>`count(*) filter (where ${callAttempts.bridged})`,
      abandoned: sql<number>`count(*) filter (where ${callAttempts.abandoned})`,
      avgTimeToHuman: avg(callAttempts.timeToHumanMs),
      avgHold: avg(callAttempts.holdMs),
    })
    .from(callAttempts)
    .where(scope);

  const dials = Number(totals?.dials ?? 0);
  const reachedHuman = Number(totals?.reachedHuman ?? 0);
  const bridged = Number(totals?.bridged ?? 0);
  const abandoned = Number(totals?.abandoned ?? 0);
  const { rate: abandonment30d } = await abandonmentRate(campaignId);

  return {
    windowMinutes,
    dials,
    dialsPerMin: dials / windowMinutes,
    humanReachRate: dials > 0 ? reachedHuman / dials : 0,
    // rep answer rate = of calls that reached a human, how many a rep answered.
    repAnswerRate: reachedHuman > 0 ? bridged / reachedHuman : 0,
    avgTimeToHumanMs: Math.round(Number(totals?.avgTimeToHuman ?? 0)),
    avgHoldMs: Math.round(Number(totals?.avgHold ?? 0)),
    abandonedInWindow: abandoned,
    abandonmentRate30d: abandonment30d,
  };
}

/** Recent call attempts with their state-machine timelines, for the dashboard. */
export async function recentCalls(campaignId: string, limit = 25) {
  return db
    .select()
    .from(callAttempts)
    .where(eq(callAttempts.campaignId, campaignId))
    .orderBy(sql`${callAttempts.startedAt} desc`)
    .limit(limit);
}
