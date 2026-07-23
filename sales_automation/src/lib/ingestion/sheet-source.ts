import type { ColumnMapping } from "@/db/schema";
import type { BatchSummary, RowResult } from "./types";
import { validateBatch, commitBatch } from "./service";
import { assignEligibleLeads } from "@/lib/campaigns/service";
import {
  readLeadRows,
  writeCells,
  firstSheetTitle,
  extractSpreadsheetId,
  SheetsError,
} from "@/lib/sheets-server";
import { SHEET_RESULT_QUEUED } from "@/lib/config";

/**
 * Google-Sheet lead source (closed-loop ingestion).
 *
 * One idempotent pass over the central sheet: read rows whose Result is empty /
 * "none", run them through the shared validation gate in B2B mode, commit the
 * leads (stamped with their sheet coordinates), assign eligible ones to the
 * campaign, and write each processed row's status back to its Result cell so the
 * next pass skips it. Invoked both by the always-on poller (real-time) and the
 * admin "Import now" route. Safe to run repeatedly — the contact-ledger dedupe
 * and the "Queued"/skip write-back both prevent re-importing the same row.
 */

/** Which Result cell values mean "not yet imported" (case-insensitive). */
function isUnprocessed(result: string): boolean {
  const v = result.trim().toLowerCase();
  return v === "" || v === "none";
}

/** Row validation status → the label written back to the sheet's Result cell. */
function statusToSheetResult(status: RowResult["status"]): string {
  switch (status) {
    case "eligible":
      return SHEET_RESULT_QUEUED; // will be dialed; dialer overwrites with outcome
    case "invalid":
      return "Invalid number";
    case "blocked":
      return "Suppressed";
    case "duplicate":
      return "Duplicate";
    case "quarantined":
      return "Skipped"; // shouldn't occur in B2B mode
  }
}

const EMPTY_SUMMARY: BatchSummary = {
  rowCount: 0,
  eligible: 0,
  quarantined: 0,
  blocked: 0,
  invalid: 0,
  duplicates: 0,
};

export type SheetImportResult = {
  summary: BatchSummary;
  imported: number; // eligible rows created + queued this pass
  batchId: string | null;
  tab: string;
};

export async function importSheetLeads(params: {
  sheetUrl: string;
  tab?: string;
  campaignId?: string;
  uploadedBy?: string;
}): Promise<SheetImportResult> {
  const tab = params.tab?.trim() || (await firstSheetTitle(params.sheetUrl));
  const { headers, headerIndex, rows } = await readLeadRows(params.sheetUrl, tab);

  // Required headers (Result must exist by that exact name, or the none-filter
  // and write-back can't work). Name/Notes are optional.
  const missing = ["company", "phone", "result"].filter(
    (h) => !(h in headerIndex),
  );
  if (missing.length > 0) {
    throw new SheetsError(
      "api_error",
      `Sheet "${tab}" is missing required column(s): ${missing.join(", ")}. ` +
        `Expected headers: Name, Company, Phone, Result, Notes.`,
    );
  }

  const resultCol = headerIndex["result"];
  const orig = (lc: string) => headers[headerIndex[lc]]; // original-case header
  const resultHeader = orig("result");

  // Select rows still awaiting import (Result empty/"none").
  const toImport = rows.filter((r) => isUnprocessed(r.values[resultHeader] ?? ""));
  if (toImport.length === 0) {
    return { summary: EMPTY_SUMMARY, imported: 0, batchId: null, tab };
  }

  // Build the fixed mapping from the sheet's actual (original-case) headers.
  const mapping: ColumnMapping = { phone: orig("phone"), company: orig("company") };
  if ("name" in headerIndex) mapping.name = orig("name");
  if ("notes" in headerIndex) mapping.notes = orig("notes");

  const rawRows = toImport.map((r) => r.values);
  const validated = await validateBatch(rawRows, mapping, { b2bMode: true });

  // rowResult.rowIndex (position within toImport) → absolute sheet row.
  const rowByIndex: Record<number, number> = {};
  toImport.forEach((r, i) => {
    rowByIndex[i] = r.sheetRow;
  });

  const batchId = await commitBatch({
    filename: `sheet:${tab}`,
    uploadedBy: params.uploadedBy ?? "sheet-import",
    mapping,
    validated,
    sheet: { spreadsheetId: extractSpreadsheetId(params.sheetUrl), tab, rowByIndex },
  });

  if (params.campaignId) await assignEligibleLeads(params.campaignId);

  // Best-effort: stamp each processed row's Result so the next pass skips it.
  // Eligible → "Queued" (the dialer overwrites it with the call outcome); others
  // → a skip label so humans see why. A failure here is non-fatal: the contact
  // ledger already prevents duplicate imports even if the write doesn't land.
  try {
    await writeCells(
      params.sheetUrl,
      tab,
      validated.rows.map((r) => ({
        sheetRow: rowByIndex[r.rowIndex],
        col0: resultCol,
        value: statusToSheetResult(r.status),
      })),
    );
  } catch (e) {
    console.error("[sheet-import] failed to write back status labels:", e);
  }

  return {
    summary: validated.summary,
    imported: validated.summary.eligible,
    batchId,
    tab,
  };
}
