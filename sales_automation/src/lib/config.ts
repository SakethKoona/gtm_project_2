import type { Bucket, BucketId, Disposition } from "./types";

/** Buckets that count toward a call's time. Order = display order. */
export const BUCKETS: Bucket[] = [
  { id: "ringing", key: "1", name: "Ringing / dialing", short: "Ringing", sub: "outbound ring", color: "#2563eb" },
  { id: "waiting", key: "2", name: "Waiting room / hold", short: "Waiting", sub: "IVR, hold, queue", color: "#d97706" },
  { id: "right", key: "3", name: "Right person", short: "Right", sub: "the conversation", color: "#16a34a" },
  { id: "wrong", key: "4", name: "Wrong person", short: "Wrong", sub: "gatekeeper, misroute", color: "#dc2626" },
  { id: "voicemail", key: "5", name: "Voicemail", short: "Voicemail", sub: "leaving / hitting VM", color: "#7c3aed" },
  { id: "noanswer", key: "6", name: "No answer / dead", short: "Dead", sub: "rings out, dead air", color: "#64748b" },
];

export const BUCKET_IDS = BUCKETS.map((b) => b.id) as BucketId[];

export const DISPOSITIONS: Disposition[] = [
  { id: "booked", key: "b", label: "Booked / meeting" },
  { id: "callback", key: "c", label: "Callback later" },
  { id: "not_interested", key: "n", label: "Not interested" },
  { id: "wrong_number", key: "w", label: "Wrong / bad number" },
  { id: "no_contact", key: "x", label: "No contact made" },
  { id: "other", key: "o", label: "Other" },
];

export function emptyAcc(): Record<BucketId, number> {
  return {
    ringing: 0,
    waiting: 0,
    right: 0,
    wrong: 0,
    voicemail: 0,
    noanswer: 0,
  };
}

export function dispositionLabel(id: string | null): string {
  if (!id) return "—";
  return DISPOSITIONS.find((d) => d.id === id)?.label ?? "—";
}
