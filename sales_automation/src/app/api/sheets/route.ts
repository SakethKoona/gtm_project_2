import type { SheetRow } from "@/lib/sheets";
import { apiGuard } from "@/lib/auth/guards";
import {
  appendRows,
  verifyAccess,
  serviceAccountEmail,
  SheetsError,
} from "@/lib/sheets-server";

// Talks to Google with server-held credentials; never cache or prerender.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body =
  | { action: "ping"; sheetUrl?: string }
  | { action: "sync"; sheetUrl?: string; rows?: SheetRow[] };

/**
 * Single endpoint for the Google Sheet sync panel.
 *  - { action: "ping" }  → verify the server can read the pasted Sheet.
 *  - { action: "sync" }  → append not-yet-synced call rows (de-duped by id).
 *
 * Errors are returned as friendly messages the panel shows verbatim, plus the
 * service-account address so the user knows exactly whom to share the Sheet with.
 */
export async function POST(request: Request) {
  const guard = await apiGuard(["rep", "admin"]);
  if (!guard.ok) return guard.res;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const sheetUrl = body.sheetUrl?.trim();
  if (!sheetUrl) {
    return Response.json(
      { ok: false, error: "Paste your Google Sheet link first." },
      { status: 400 },
    );
  }

  try {
    if (body.action === "ping") {
      await verifyAccess(sheetUrl);
      return Response.json({ ok: true, serviceAccountEmail: serviceAccountEmail() });
    }

    if (body.action === "sync") {
      const rows = Array.isArray(body.rows) ? body.rows : [];
      const syncedIds = await appendRows(sheetUrl, rows);
      return Response.json({ ok: true, syncedIds });
    }

    return Response.json({ ok: false, error: "Unknown action." }, { status: 400 });
  } catch (err) {
    if (err instanceof SheetsError) {
      const status =
        err.code === "not_configured" || err.code === "auth_failed" ? 500 : 400;
      return Response.json(
        { ok: false, error: err.message, serviceAccountEmail: serviceAccountEmail() },
        { status },
      );
    }
    return Response.json(
      { ok: false, error: "Unexpected error syncing to Google Sheets." },
      { status: 500 },
    );
  }
}
