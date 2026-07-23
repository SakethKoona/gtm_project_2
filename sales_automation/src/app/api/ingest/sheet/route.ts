import { z } from "zod";
import { apiGuard } from "@/lib/auth/guards";
import { importSheetLeads } from "@/lib/ingestion/sheet-source";
import { SheetsError, serviceAccountEmail } from "@/lib/sheets-server";
import {
  getLeadSheetConfig,
  setSetting,
  SETTINGS_KEYS,
} from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Central Google-Sheet lead import (admin).
 *  - GET  → the saved sheet config (URL / tab / campaign / poll toggle).
 *  - POST → persist the config, then run one import pass and return the summary.
 * The always-on poller (telephony-server) reads the same config each tick.
 */

export async function GET() {
  const guard = await apiGuard(["admin"]);
  if (!guard.ok) return guard.res;
  const cfg = await getLeadSheetConfig();
  return Response.json({ ...cfg, serviceAccountEmail: serviceAccountEmail() });
}

const bodySchema = z.object({
  sheetUrl: z.string().min(1).optional(),
  tab: z.string().optional(),
  campaignId: z.string().uuid().optional(),
  // When false, only save config (no import). Defaults to running an import.
  runImport: z.boolean().optional(),
});

export async function POST(request: Request) {
  const guard = await apiGuard(["admin"]);
  if (!guard.ok) return guard.res;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "invalid", detail: parsed.error.flatten() }, { status: 400 });
  }
  const b = parsed.data;

  // Persist whatever config was supplied so the poller uses it too.
  if (b.sheetUrl !== undefined)
    await setSetting(SETTINGS_KEYS.leadSheetUrl, b.sheetUrl.trim() || null);
  if (b.tab !== undefined)
    await setSetting(SETTINGS_KEYS.leadSheetTab, b.tab.trim() || null);
  if (b.campaignId !== undefined)
    await setSetting(SETTINGS_KEYS.leadSheetCampaignId, b.campaignId || null);

  const cfg = await getLeadSheetConfig();
  if (b.runImport === false) {
    return Response.json({ ok: true, saved: true, config: cfg });
  }

  if (!cfg.sheetUrl) {
    return Response.json(
      { error: "No sheet URL configured. Paste the central Sheet link first." },
      { status: 400 },
    );
  }

  try {
    const result = await importSheetLeads({
      sheetUrl: cfg.sheetUrl,
      tab: cfg.tab ?? undefined,
      campaignId: cfg.campaignId ?? undefined,
      uploadedBy: guard.userId,
    });
    return Response.json({ ok: true, ...result, config: cfg });
  } catch (e) {
    if (e instanceof SheetsError) {
      const status = e.code === "not_configured" || e.code === "auth_failed" ? 500 : 400;
      return Response.json(
        { error: e.message, code: e.code, serviceAccountEmail: serviceAccountEmail() },
        { status },
      );
    }
    console.error("[ingest/sheet] import failed:", e);
    return Response.json({ error: (e as Error).message ?? "import failed" }, { status: 500 });
  }
}
