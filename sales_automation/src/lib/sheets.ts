import type { Call } from "./types";
import { callTotal } from "./format";
import { dispositionLabel } from "./config";

/**
 * Google Sheets live sync (client side).
 *
 * The browser never talks to Google directly — it POSTs finished calls to our own
 * `/api/sheets` route, which holds the service-account credentials and appends to
 * the Sheet. The user only ever pastes a normal Google Sheet link; setup is in
 * SHEETS_SETUP.md. Each call has a stable id and the server de-dupes on it, so
 * retries are safe.
 */

/** Column order written to the Sheet (shared by client + server). */
export const SHEET_HEADERS = [
  "id",
  "started",
  "ended",
  "ringing_s",
  "waiting_s",
  "right_s",
  "wrong_s",
  "voicemail_s",
  "noanswer_s",
  "total_s",
  "disposition",
  "note",
] as const;

export type SheetRow = Record<(typeof SHEET_HEADERS)[number], string | number>;

const secs = (ms: number) => Math.round((ms || 0) / 1000);

export function callToRow(c: Call): SheetRow {
  // Round each bucket first, then sum — so total_s equals the sum of the columns.
  const ringing_s = secs(c.acc.ringing);
  const waiting_s = secs(c.acc.waiting);
  const right_s = secs(c.acc.right);
  const wrong_s = secs(c.acc.wrong);
  const voicemail_s = secs(c.acc.voicemail);
  const noanswer_s = secs(c.acc.noanswer);
  return {
    id: c.id,
    started: new Date(c.startedAt).toISOString(),
    ended: new Date(c.endedAt).toISOString(),
    ringing_s,
    waiting_s,
    right_s,
    wrong_s,
    voicemail_s,
    noanswer_s,
    // Real call duration (start → end), not the sum of tracked buckets.
    total_s: secs(callTotal(c)),
    disposition: dispositionLabel(c.disposition),
    note: c.note || "",
  };
}

type PingResult = { ok: boolean; email?: string; error?: string };

async function callApi(payload: unknown): Promise<Record<string, unknown>> {
  const res = await fetch("/api/sheets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ...data, _status: res.status };
}

/** Verify the server can read the pasted Sheet. Returns the address to share with. */
export async function pingSheet(sheetUrl: string): Promise<PingResult> {
  const data = await callApi({ action: "ping", sheetUrl });
  return {
    ok: data.ok === true,
    email: data.serviceAccountEmail as string | undefined,
    error: data.error as string | undefined,
  };
}

/**
 * Push all not-yet-synced calls. Returns the ids that were successfully synced,
 * so the caller marks exactly those (merge-safe even if new calls arrived
 * mid-sync). On failure nothing is marked and it's retried next time.
 */
export async function syncCalls(
  sheetUrl: string,
  calls: Call[],
): Promise<string[]> {
  const rows = calls.filter((c) => !c.synced).map(callToRow);
  if (rows.length === 0) return [];
  const data = await callApi({ action: "sync", sheetUrl, rows });
  if (data.ok !== true) {
    throw new Error((data.error as string) || "Sync failed.");
  }
  return (data.syncedIds as string[]) ?? [];
}
