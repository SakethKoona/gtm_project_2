import { z } from "zod";
import { apiGuard } from "@/lib/auth/guards";
import {
  listLeadSheets,
  addLeadSheet,
  updateLeadSheet,
  deleteLeadSheet,
  getLeadSheet,
} from "@/lib/lead-sheets";
import { importSheetLeads } from "@/lib/ingestion/sheet-source";
import { SheetsError, serviceAccountEmail } from "@/lib/sheets-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Central lead sheets (admin). Supports multiple sheets.
 *  - GET  → list every linked sheet.
 *  - POST → { action: add | update | delete | import }.
 * The always-on ingest worker reads every enabled sheet on its own loop; "import"
 * here just runs one sheet immediately.
 */

export async function GET() {
  const guard = await apiGuard(["admin"]);
  if (!guard.ok) return guard.res;
  return Response.json({
    sheets: await listLeadSheets(),
    serviceAccountEmail: serviceAccountEmail(),
  });
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add"),
    name: z.string().optional(),
    url: z.string().min(1),
    tab: z.string().optional(),
    campaignId: z.string().uuid().optional(),
  }),
  z.object({
    action: z.literal("update"),
    id: z.string().uuid(),
    name: z.string().nullable().optional(),
    url: z.string().min(1).optional(),
    tab: z.string().nullable().optional(),
    campaignId: z.string().uuid().nullable().optional(),
    enabled: z.boolean().optional(),
  }),
  z.object({ action: z.literal("delete"), id: z.string().uuid() }),
  z.object({ action: z.literal("import"), id: z.string().uuid() }),
]);

export async function POST(request: Request) {
  const guard = await apiGuard(["admin"]);
  if (!guard.ok) return guard.res;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "invalid", detail: parsed.error.flatten() }, { status: 400 });
  }
  const b = parsed.data;

  try {
    if (b.action === "add") {
      await addLeadSheet({ name: b.name, url: b.url, tab: b.tab, campaignId: b.campaignId });
    } else if (b.action === "update") {
      const { action, id, ...patch } = b;
      void action;
      await updateLeadSheet(id, patch);
    } else if (b.action === "delete") {
      await deleteLeadSheet(b.id);
    } else if (b.action === "import") {
      const sheet = await getLeadSheet(b.id);
      if (!sheet) return Response.json({ error: "sheet not found" }, { status: 404 });
      const result = await importSheetLeads({
        sheetUrl: sheet.url,
        tab: sheet.tab ?? undefined,
        campaignId: sheet.campaignId ?? undefined,
        uploadedBy: guard.userId,
      });
      return Response.json({ ok: true, sheets: await listLeadSheets(), result });
    }
    return Response.json({ ok: true, sheets: await listLeadSheets() });
  } catch (e) {
    if (e instanceof SheetsError) {
      const status = e.code === "not_configured" || e.code === "auth_failed" ? 500 : 400;
      return Response.json(
        { error: e.message, code: e.code, serviceAccountEmail: serviceAccountEmail() },
        { status },
      );
    }
    console.error("[lead-sheets] failed:", e);
    return Response.json({ error: (e as Error).message ?? "failed" }, { status: 500 });
  }
}
