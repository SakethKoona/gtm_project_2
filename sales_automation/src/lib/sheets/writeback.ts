import { eq } from "drizzle-orm";
import { db } from "@/db";
import { leads, auditLog } from "@/db/schema";
import { normalizePhone } from "@/lib/ingestion/phone";
import { readLeadRows, writeCells, type SheetLeadRow } from "@/lib/sheets-server";
import { SHEET_RESULT_QUEUED } from "@/lib/config";

/**
 * Closed-loop result write-back: after a call completes, update the lead's row in
 * the central Google Sheet with the friendly Result label + Notes.
 *
 * Best-effort by contract — every failure is caught, audit-logged, and swallowed
 * so a Sheets hiccup never breaks the call path. Row matching is authoritative on
 * phone (E.164), using the stored `sourceSheetRow` only as a fast-path hint that
 * is re-verified before trusting, so the external service inserting/reordering
 * rows can't cause a mis-write.
 */

function toE164(raw: string): string | null {
  const p = normalizePhone(raw);
  return p.ok ? p.e164 : null;
}

export async function writeLeadResult(
  leadId: string,
  result: string,
  notes: string,
): Promise<void> {
  try {
    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
    // No sheet provenance ⇒ not a sheet-sourced lead ⇒ nothing to write.
    if (!lead?.sourceSheetId || !lead.sourceSheetTab || !lead.phone) return;

    const { headers, headerIndex, rows } = await readLeadRows(
      lead.sourceSheetId,
      lead.sourceSheetTab,
    );
    if (!("phone" in headerIndex) || !("result" in headerIndex)) return;

    const phoneHeader = headers[headerIndex["phone"]];
    const resultHeader = headers[headerIndex["result"]];
    const companyHeader =
      "company" in headerIndex ? headers[headerIndex["company"]] : null;

    const target = locateRow(rows, {
      phone: lead.phone,
      company: lead.company,
      hintRow: lead.sourceSheetRow,
      phoneHeader,
      resultHeader,
      companyHeader,
    });

    if (!target) {
      await audit("sheet.writeback.row_missing", lead.phone, {
        leadId,
        sheetId: lead.sourceSheetId,
        tab: lead.sourceSheetTab,
        hintRow: lead.sourceSheetRow,
      });
      return;
    }

    const cells = [
      { sheetRow: target.sheetRow, col0: headerIndex["result"], value: result },
    ];
    if ("notes" in headerIndex) {
      cells.push({
        sheetRow: target.sheetRow,
        col0: headerIndex["notes"],
        value: notes ?? "",
      });
    }
    await writeCells(lead.sourceSheetId, lead.sourceSheetTab, cells);

    // Self-heal the stored hint if the row drifted.
    if (target.sheetRow !== lead.sourceSheetRow) {
      await db
        .update(leads)
        .set({ sourceSheetRow: target.sheetRow })
        .where(eq(leads.id, leadId));
    }
  } catch (e) {
    await audit("sheet.writeback.failed", null, {
      leadId,
      error: (e as Error)?.message ?? String(e),
    }).catch(() => {});
  }
}

/** Find the sheet row for a lead: verified hint first, then phone re-scan. */
function locateRow(
  rows: SheetLeadRow[],
  ctx: {
    phone: string;
    company: string | null;
    hintRow: number | null;
    phoneHeader: string;
    resultHeader: string;
    companyHeader: string | null;
  },
): SheetLeadRow | null {
  const phoneMatches = (r: SheetLeadRow) =>
    toE164(r.values[ctx.phoneHeader] ?? "") === ctx.phone;

  // 1. Fast path: the stored hint row, only if its phone still matches.
  if (ctx.hintRow != null) {
    const hit = rows.find((r) => r.sheetRow === ctx.hintRow);
    if (hit && phoneMatches(hit)) return hit;
  }

  // 2. Re-scan by phone.
  const matches = rows.filter(phoneMatches);
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) return null;

  // 3. Duplicate phones: prefer a still-"Queued" row (a genuinely new re-appended
  // "none"/other-state row is not a candidate), then a company match.
  const queued = matches.filter(
    (r) =>
      (r.values[ctx.resultHeader] ?? "").trim().toLowerCase() ===
      SHEET_RESULT_QUEUED.toLowerCase(),
  );
  const pool = queued.length > 0 ? queued : matches;
  if (ctx.companyHeader && ctx.company) {
    const want = ctx.company.trim().toLowerCase();
    const byCompany = pool.find(
      (r) => (r.values[ctx.companyHeader!] ?? "").trim().toLowerCase() === want,
    );
    if (byCompany) return byCompany;
  }
  return pool[0];
}

function audit(
  event: string,
  subjectPhone: string | null,
  detail: Record<string, unknown>,
): Promise<unknown> {
  return db.insert(auditLog).values({ event, subjectPhone, detail });
}
