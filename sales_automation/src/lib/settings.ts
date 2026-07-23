import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";

/**
 * Tiny key/value settings store (app_settings table) for singleton config the
 * admin sets in the UI rather than via env. Used by the central-Sheet ingester.
 */

export const SETTINGS_KEYS = {
  leadSheetUrl: "lead_sheet_url",
  leadSheetTab: "lead_sheet_tab",
  leadSheetCampaignId: "lead_sheet_campaign_id",
} as const;

export async function getSetting(key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key));
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string | null): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: sql`now()` },
    });
}

// The legacy single-sheet config (lead_sheet_url/tab/campaign_id) is now migrated
// into the lead_sheets table on first read — see src/lib/lead-sheets.ts. The keys
// above are kept only so that migration can find + clear them.
