import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { leadSheets } from "@/db/schema";
import { getSetting, setSetting, SETTINGS_KEYS } from "./settings";

/**
 * Central lead sheets registry. Multiple sheets are supported; the ingest worker
 * reads every enabled one each pass, each into its own campaign.
 */

export type LeadSheet = typeof leadSheets.$inferSelect;

/**
 * One-time fold of the legacy single-sheet app_settings config into a lead_sheets
 * row, then clear the legacy key so we don't repeat. Idempotent; safe to call often.
 */
async function migrateLegacy(): Promise<void> {
  const url = await getSetting(SETTINGS_KEYS.leadSheetUrl);
  if (!url) return;
  const existing = await db
    .select({ id: leadSheets.id })
    .from(leadSheets)
    .where(eq(leadSheets.url, url));
  if (existing.length === 0) {
    await db.insert(leadSheets).values({
      url,
      tab: (await getSetting(SETTINGS_KEYS.leadSheetTab)) || null,
      campaignId: (await getSetting(SETTINGS_KEYS.leadSheetCampaignId)) || null,
      enabled: true,
    });
  }
  await setSetting(SETTINGS_KEYS.leadSheetUrl, null); // done — don't re-migrate
}

export async function listLeadSheets(): Promise<LeadSheet[]> {
  await migrateLegacy();
  return db.select().from(leadSheets).orderBy(asc(leadSheets.createdAt));
}

export async function listEnabledLeadSheets(): Promise<LeadSheet[]> {
  await migrateLegacy();
  return db
    .select()
    .from(leadSheets)
    .where(eq(leadSheets.enabled, true))
    .orderBy(asc(leadSheets.createdAt));
}

export async function addLeadSheet(input: {
  name?: string | null;
  url: string;
  tab?: string | null;
  campaignId?: string | null;
}): Promise<LeadSheet> {
  const [row] = await db
    .insert(leadSheets)
    .values({
      name: input.name ?? null,
      url: input.url,
      tab: input.tab ?? null,
      campaignId: input.campaignId ?? null,
    })
    .returning();
  return row;
}

export async function updateLeadSheet(
  id: string,
  patch: Partial<Pick<LeadSheet, "name" | "url" | "tab" | "campaignId" | "enabled">>,
): Promise<void> {
  await db.update(leadSheets).set(patch).where(eq(leadSheets.id, id));
}

export async function deleteLeadSheet(id: string): Promise<void> {
  await db.delete(leadSheets).where(eq(leadSheets.id, id));
}

export async function getLeadSheet(id: string): Promise<LeadSheet | null> {
  const [row] = await db.select().from(leadSheets).where(eq(leadSheets.id, id));
  return row ?? null;
}
