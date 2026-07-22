import { AsyncQueue } from "./async-queue";
import type { MediaEvent } from "./provider";

/**
 * In-process registry shared by the Twilio provider and the webhook/Media-Stream
 * server (they run in the same always-on process). It lets the push-side
 * (Twilio callbacks + audio frames) hand data to the pull-side (the
 * orchestrator's per-call state machine) keyed by the Twilio call SID.
 *
 * Production across multiple server instances would shard this by call SID with
 * sticky routing, or move coordination to Redis — the shapes are unchanged.
 */

export type CallSession = {
  callSid: string;
  conferenceName: string;
  events: AsyncQueue<MediaEvent>;
  /** Set while a hand-off is ringing reps; resolves with the winning rep. */
  repRace: {
    resolve: (winner: { repId: string } | null) => void;
    /** repCallSid → repId, so an "answered" status callback finds the rep. */
    repCallSids: Map<string, string>;
    settled: boolean;
  } | null;
  amdReported: boolean;
  /** Set once the lead-answered ("answered") event has been emitted. */
  answeredReported: boolean;
};

const sessions = new Map<string, CallSession>();
// repCallSid → leadCallSid, so rep-leg status callbacks find the lead session.
const repToLead = new Map<string, string>();

export function createSession(callSid: string, conferenceName: string): CallSession {
  const s: CallSession = {
    callSid,
    conferenceName,
    events: new AsyncQueue<MediaEvent>(),
    repRace: null,
    amdReported: false,
    answeredReported: false,
    };
  sessions.set(callSid, s);
  return s;
}

export function getSession(callSid: string): CallSession | undefined {
  return sessions.get(callSid);
}

/** Look up the lead session that a rep call leg belongs to. */
export function getSessionByRepCall(repCallSid: string): CallSession | undefined {
  const leadSid = repToLead.get(repCallSid);
  return leadSid ? sessions.get(leadSid) : undefined;
}

export function registerRepCall(
  leadCallSid: string,
  repCallSid: string,
  repId: string,
): void {
  repToLead.set(repCallSid, leadCallSid);
  sessions.get(leadCallSid)?.repRace?.repCallSids.set(repCallSid, repId);
}

export function endSession(callSid: string): void {
  const s = sessions.get(callSid);
  if (!s) return;
  s.events.close();
  for (const repSid of s.repRace?.repCallSids.keys() ?? []) {
    repToLead.delete(repSid);
  }
  sessions.delete(callSid);
}
