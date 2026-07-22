import { and, eq, isNull, or, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { campaigns, reps, leads } from "@/db/schema";

/** A browser rep is "online" if it heartbeat within this window. */
const ONLINE_WINDOW = "30 seconds";

/** The Twilio Voice SDK client identity for a browser rep (from its user). */
export function repClientIdentity(userId: string): string {
  return `rep_${userId}`;
}

/**
 * Ensure a browser (softphone) rep row exists for a logged-in user, and return
 * it. Browser reps are global (no campaignId) — any online one can take a call.
 */
export async function ensureBrowserRep(userId: string, name: string) {
  const existing = (
    await db.select().from(reps).where(eq(reps.userId, userId))
  )[0];
  if (existing) return existing;
  const [row] = await db
    .insert(reps)
    .values({ name, kind: "browser", userId, presence: "away" })
    .returning();
  return row;
}

/** Heartbeat a browser rep: online → available + fresh lastSeen, else away. */
export async function setBrowserPresence(userId: string, online: boolean) {
  await db
    .update(reps)
    .set({
      presence: online ? "available" : "away",
      lastSeen: online ? new Date() : null,
    })
    .where(eq(reps.userId, userId));
}

type NewCampaign = Partial<typeof campaigns.$inferInsert> & { name: string };

export async function createCampaign(input: NewCampaign) {
  const [row] = await db.insert(campaigns).values(input).returning();
  return row;
}

export async function listCampaigns() {
  return db.select().from(campaigns).orderBy(campaigns.createdAt);
}

export async function getCampaign(id: string) {
  const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  return row ?? null;
}

export async function setCampaignStatus(
  id: string,
  status: "draft" | "active" | "paused",
) {
  await db.update(campaigns).set({ status }).where(eq(campaigns.id, id));
}

export async function addRep(input: {
  name: string;
  phone: string;
  campaignId?: string;
}) {
  const [row] = await db.insert(reps).values(input).returning();
  return row;
}

export async function setRepPresence(
  repId: string,
  presence: "available" | "away",
) {
  await db.update(reps).set({ presence }).where(eq(reps.id, repId));
}

export async function setRepOnCall(repId: string, onCall: boolean) {
  await db.update(reps).set({ onCall }).where(eq(reps.id, repId));
}

/**
 * Free reps for a campaign = present AND not currently bridged. This count feeds
 * the concurrency governor (freeReps * OVERDIAL_RATIO).
 */
export async function listFreeReps(campaignId: string) {
  // Free = not on a call, AND either:
  //  - a phone rep assigned to this campaign and marked available, OR
  //  - a browser rep that is online (heartbeat within the window). Browser reps
  //    are a global pool — any online one can take a call for any campaign.
  return db
    .select()
    .from(reps)
    .where(
      and(
        eq(reps.onCall, false),
        or(
          and(
            eq(reps.kind, "phone"),
            eq(reps.campaignId, campaignId),
            eq(reps.presence, "available"),
          ),
          and(
            eq(reps.kind, "browser"),
            eq(reps.presence, "available"),
            gte(reps.lastSeen, sql`now() - interval '${sql.raw(ONLINE_WINDOW)}'`),
          ),
        ),
      ),
    );
}

export async function listCampaignReps(campaignId: string) {
  return db.select().from(reps).where(eq(reps.campaignId, campaignId));
}

/**
 * Assign eligible, unassigned leads to a campaign. Only dial-eligible leads that
 * aren't already in another campaign are pulled in (spec frequency rule: a lead
 * shouldn't be live in two campaigns at once).
 */
export async function assignEligibleLeads(campaignId: string, limit = 1000) {
  const eligible = await db
    .select({ id: leads.id })
    .from(leads)
    .where(
      and(eq(leads.validationStatus, "eligible"), isNull(leads.campaignId)),
    )
    .limit(limit);

  if (eligible.length === 0) return 0;
  for (const l of eligible) {
    await db
      .update(leads)
      .set({ campaignId })
      .where(eq(leads.id, l.id));
  }
  return eligible.length;
}

/** Dial-eligible leads currently assigned to a campaign. */
export async function listCampaignLeads(campaignId: string) {
  return db
    .select()
    .from(leads)
    .where(
      and(
        eq(leads.campaignId, campaignId),
        eq(leads.validationStatus, "eligible"),
      ),
    );
}
