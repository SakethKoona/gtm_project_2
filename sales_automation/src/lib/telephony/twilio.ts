import twilio from "twilio";
import type { TelephonyProvider, OutboundHandle } from "./provider";
import {
  createSession,
  getSession,
  endSession,
  registerRepCall,
} from "./registry";

/**
 * TwilioTelephonyProvider — real outbound calling via Twilio Programmable Voice.
 *
 * Design honoring the hard constraint (no synthesized audio to the lead):
 *  - The lead leg is parked in a **conference** whose wait audio is SILENCE
 *    (waitUrl → a <Pause>), never hold music or TTS.
 *  - Media is forked to our Media Stream (<Start><Stream>) for classification —
 *    listen-only; we never speak to the lead.
 *  - IVR digits are injected by briefly redirecting the leg to <Play digits> then
 *    rejoining the conference. DTMF only.
 *  - Hand-off dials reps into the SAME conference; first to answer is bridged.
 *    A whisper (<Say>) plays to the rep BEFORE they join — rep-ear only.
 *
 * Requires env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_NUMBER, PUBLIC_URL.
 * This code is written against Twilio's documented API but must be exercised
 * against a live account + public tunnel + a real phone to validate end to end.
 */
export class TwilioTelephonyProvider implements TelephonyProvider {
  private client: twilio.Twilio;
  private from: string;
  private publicUrl: string;

  constructor(opts?: {
    accountSid?: string;
    authToken?: string;
    from?: string;
    publicUrl?: string;
  }) {
    const accountSid = opts?.accountSid ?? process.env.TWILIO_ACCOUNT_SID!;
    const authToken = opts?.authToken ?? process.env.TWILIO_AUTH_TOKEN!;
    this.from = opts?.from ?? process.env.TWILIO_NUMBER!;
    this.publicUrl = (opts?.publicUrl ?? process.env.PUBLIC_URL!).replace(/\/$/, "");
    if (!accountSid || !authToken || !this.from || !this.publicUrl) {
      throw new Error(
        "Twilio provider needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_NUMBER, PUBLIC_URL",
      );
    }
    this.client = twilio(accountSid, authToken);
  }

  async placeCall(to: string, from?: string): Promise<OutboundHandle> {
    const conf = `lead-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Connect-on-answer mode: bridge the rep the instant the call is answered
    // (see the /status handler), skipping AMD entirely. Fastest time-to-human and
    // no false "voicemail" drops — the rep just hangs up on the rare machine.
    const connectOnAnswer = process.env.DIAL_CONNECT_ON_ANSWER === "true";

    const amd = connectOnAnswer
      ? {}
      : {
          // "Enable" decides human-vs-machine fast and biases toward real people.
          machineDetection: "Enable" as const,
          // Max seconds AMD analyzes before "unknown" (min 3). "unknown" connects.
          machineDetectionTimeout: 3,
          // Flag a machine only after this much continuous speech (above the 2400ms
          // default so a normal greeting isn't mistaken for a machine).
          machineDetectionSpeechThreshold: 4000,
          // Silence after the greeting to conclude "human" — bridge as they stop.
          machineDetectionSpeechEndThreshold: 800,
          // Silence if they answer and say nothing — connect a quiet human faster.
          machineDetectionSilenceTimeout: 3000,
          asyncAmd: "true" as const,
          asyncAmdStatusCallback: `${this.publicUrl}/amd`,
          asyncAmdStatusCallbackMethod: "POST" as const,
        };

    const call = await this.client.calls.create({
      to,
      from: from || this.from,
      // On answer, Twilio fetches TwiML that forks media + parks in a silent conf.
      url: `${this.publicUrl}/twiml/outbound?conf=${encodeURIComponent(conf)}`,
      method: "POST",
      ...amd,
      statusCallback: `${this.publicUrl}/status`,
      statusCallbackEvent: ["answered", "completed"],
      statusCallbackMethod: "POST",
    });

    const session = createSession(call.sid, conf);
    return { callId: call.sid, events: session.events };
  }

  async sendDigits(callId: string, digits: string): Promise<void> {
    const session = getSession(callId);
    const conf = session?.conferenceName ?? "";
    // Redirect the lead leg out of the conference to play DTMF, then rejoin.
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play digits="${digits}"/>
  <Redirect method="POST">${this.publicUrl}/twiml/outbound?conf=${encodeURIComponent(conf)}&amp;rejoin=1</Redirect>
</Response>`;
    await this.client.calls(callId).update({ twiml });
  }

  async ringReps(
    callId: string,
    repPhones: { repId: string; phone: string }[],
    timeoutMs: number,
    whisper?: string,
  ): Promise<{ repId: string } | null> {
    if (repPhones.length === 0) return null;
    const session = getSession(callId);
    if (!session) return null;

    return new Promise<{ repId: string } | null>((resolve) => {
      let settled = false;
      const finish = (winner: { repId: string } | null) => {
        if (settled) return;
        settled = true;
        session.repRace = session.repRace
          ? { ...session.repRace, settled: true }
          : null;
        resolve(winner);
      };
      session.repRace = {
        resolve: finish,
        repCallSids: new Map(),
        settled: false,
      };

      const conf = session.conferenceName;
      const whisperParam = whisper
        ? `&amp;whisper=${encodeURIComponent(whisper)}`
        : "";
      // Ring every rep simultaneously; first "answered" callback wins. Collect
      // every leg's create+register into one Promise.all (instead of firing
      // each unawaited) so registration failures aren't silently dropped and
      // every callSid lands in repCallSids as soon as it's known.
      Promise.all(
        repPhones.map((rep) =>
          this.client.calls
            .create({
              to: rep.phone,
              from: this.from,
              url: `${this.publicUrl}/twiml/rep-join?conf=${encodeURIComponent(conf)}${whisperParam}`,
              method: "POST",
              statusCallback: `${this.publicUrl}/rep-status?leadCallSid=${session.callSid}&repId=${rep.repId}`,
              statusCallbackEvent: ["answered", "completed"],
              statusCallbackMethod: "POST",
              timeout: Math.ceil(timeoutMs / 1000),
            })
            .then((repCall) =>
              registerRepCall(session.callSid, repCall.sid, rep.repId),
            )
            .catch((e) => console.error("rep dial failed", rep.repId, e)),
        ),
      );

      setTimeout(() => finish(null), timeoutMs);
    });
  }

  async bridge(_callId: string, _repId: string): Promise<void> {
    // Bridging is implicit: the winning rep joins the lead's conference. Losing
    // rep legs are hung up by the server's rep-status handler. Nothing to do.
  }

  async releaseReps(callId: string): Promise<void> {
    // Hang up every rep leg rung for this call (a pre-rung rep parked in the
    // conference), leaving the lead call untouched. Already-completed legs no-op.
    const session = getSession(callId);
    const repSids = session?.repRace?.repCallSids;
    if (!repSids) return;
    await Promise.all(
      [...repSids.keys()].map((repCallSid) =>
        this.client
          .calls(repCallSid)
          .update({ status: "completed" })
          .catch(() => {}),
      ),
    );
    // Settle the race so a late "answered" callback can't resolve a dead handoff.
    if (session?.repRace) session.repRace.settled = true;
  }

  async hangup(callId: string): Promise<void> {
    endSession(callId);
    await this.client
      .calls(callId)
      .update({ status: "completed" })
      .catch(() => {});
  }
}
