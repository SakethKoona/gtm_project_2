import type { Bucket, BucketId, Disposition } from "./types";

/** Buckets that count toward a call's time. Order = display order. */
export const BUCKETS: Bucket[] = [
  { id: "ringing", key: "1", name: "Ringing / dialing", short: "Ringing", sub: "outbound ring", color: "#60a5fa" },
  { id: "waiting", key: "2", name: "Waiting room / hold", short: "Waiting", sub: "IVR, hold, queue", color: "#fbbf24" },
  { id: "right", key: "3", name: "Right person", short: "Right", sub: "the conversation", color: "#4ade80" },
  { id: "wrong", key: "4", name: "Wrong person", short: "Wrong", sub: "gatekeeper, misroute", color: "#f87171" },
  { id: "voicemail", key: "5", name: "Voicemail", short: "Voicemail", sub: "leaving / hitting VM", color: "#a78bfa" },
  { id: "noanswer", key: "6", name: "No answer / dead", short: "Dead", sub: "rings out, dead air", color: "#9ca3af" },
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

/**
 * OUTCOME_TEMPLATES — prefilled one-click call-outcome documentation (spec §3).
 * Each template pre-fills the composer body, advances the lead's pipeline stage,
 * and may suggest a follow-up channel. `do_not_call` additionally routes through
 * the compliance opt-out path (recordOptOut) at log time.
 */
export const OUTCOME_TEMPLATES = [
  { key: "interested",     label: "Interested — send info", body: "Spoke with the lead — interested, send more information.", stage: "qualified",      suggestFollowUp: "email" },
  { key: "callback",       label: "Callback requested",     body: "Lead asked to be called back.",                           stage: "follow_up",      suggestFollowUp: "call"  },
  { key: "meeting",        label: "Meeting booked",         body: "Booked a meeting with the lead.",                         stage: "won",            suggestFollowUp: "email" },
  { key: "voicemail",      label: "Left voicemail",         body: "No answer — left a voicemail.",                           stage: "contacted",      suggestFollowUp: "call"  },
  { key: "no_answer",      label: "No answer",              body: "No answer, no voicemail left.",                           stage: "contacted",      suggestFollowUp: "call"  },
  { key: "wrong_number",   label: "Wrong number",           body: "Number does not belong to this lead.",                    stage: "lost",           suggestFollowUp: null    },
  { key: "not_interested", label: "Not interested",         body: "Lead is not interested.",                                 stage: "lost",           suggestFollowUp: null    },
  { key: "do_not_call",    label: "Do not contact",         body: "Lead asked not to be contacted again.",                   stage: "do_not_contact", suggestFollowUp: null    },
] as const;
export type OutcomeTemplate = (typeof OUTCOME_TEMPLATES)[number];
