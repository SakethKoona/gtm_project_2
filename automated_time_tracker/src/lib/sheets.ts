import type { Call } from "./types";
import { callTotal } from "./format";
import { dispositionLabel } from "./config";

/**
 * Google Sheets live sync via a Google Apps Script web app (see SHEETS_SETUP.md).
 * text/plain keeps the request a "simple" CORS request (no preflight, which Apps
 * Script can't answer). Each call has a stable id; the script de-dupes on it, so
 * retries are safe.
 *
 * Expansion note: when you add a real backend, you can move this behind a Next.js
 * API route (server-side Sheets API or a DB) without touching the UI.
 */

const secs = (ms: number) => Math.round((ms || 0) / 1000);

export function callToRow(c: Call) {
  return {
    id: c.id,
    started: new Date(c.startedAt).toISOString(),
    ended: new Date(c.endedAt).toISOString(),
    ringing_s: secs(c.acc.ringing),
    waiting_s: secs(c.acc.waiting),
    right_s: secs(c.acc.right),
    wrong_s: secs(c.acc.wrong),
    voicemail_s: secs(c.acc.voicemail),
    noanswer_s: secs(c.acc.noanswer),
    total_s: secs(callTotal(c)),
    disposition: dispositionLabel(c.disposition),
    note: c.note || "",
  };
}

async function post(url: string, payload: unknown): Promise<{ ok?: boolean }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
    redirect: "follow",
  });
  return res.json();
}

export async function pingSheet(url: string): Promise<boolean> {
  const r = await post(url, { type: "ping" });
  return !!r.ok;
}

/**
 * Push all not-yet-synced calls. Returns the ids that were successfully synced,
 * so the caller can mark exactly those (merge-safe even if new calls arrived
 * mid-sync). Failures are left unsynced and retried next time.
 */
export async function syncCalls(url: string, calls: Call[]): Promise<string[]> {
  const done: string[] = [];
  for (const c of calls) {
    if (c.synced) continue;
    try {
      const r = await post(url, { type: "call", call: callToRow(c) });
      if (r.ok) done.push(c.id);
    } catch {
      /* leave pending; retried next time */
    }
  }
  return done;
}
