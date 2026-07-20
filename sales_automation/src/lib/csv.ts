import type { Call } from "./types";
import { callTotal } from "./format";
import { dispositionLabel } from "./config";

function csvValue(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const secs = (ms: number) => Math.round((ms || 0) / 1000);

export function buildCsv(calls: Call[]): string {
  const header = [
    "started", "ended", "ringing_s", "waiting_s", "right_s", "wrong_s",
    "voicemail_s", "noanswer_s", "total_s", "disposition", "note",
  ];
  const rows = calls
    .slice()
    .reverse()
    .map((c) => [
      new Date(c.startedAt).toISOString(),
      new Date(c.endedAt).toISOString(),
      secs(c.acc.ringing), secs(c.acc.waiting), secs(c.acc.right), secs(c.acc.wrong),
      secs(c.acc.voicemail), secs(c.acc.noanswer), secs(callTotal(c)),
      dispositionLabel(c.disposition), c.note || "",
    ]);
  return [header, ...rows].map((r) => r.map(csvValue).join(",")).join("\n");
}

export function downloadCsv(calls: Call[]): void {
  const blob = new Blob([buildCsv(calls)], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `call-time-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
