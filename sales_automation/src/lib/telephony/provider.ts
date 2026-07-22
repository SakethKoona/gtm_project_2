/**
 * TelephonyProvider — the seam between the orchestrator and the phone network.
 *
 * The orchestrator never talks to a carrier directly; it talks to this
 * interface. A real implementation (Twilio, or self-hosted FreeSWITCH/Jambonz +
 * a SIP trunk) is a one-file swap. The simulated implementation lets the whole
 * orchestration — state machine, IVR navigation, hand-off, governor — be driven
 * and verified end-to-end WITHOUT placing real calls or incurring carrier cost.
 *
 * IMPORTANT (spec hard constraint): there is no "play audio to the lead"
 * primitive on purpose. The provider can inject DTMF and bridge legs; it cannot
 * synthesize speech toward the called party.
 */

export type MediaEvent =
  | { type: "ringing" }
  | { type: "answered" }
  | { type: "audio"; label: AudioLabel; transcript?: string }
  | { type: "hangup" };

/**
 * Coarse audio labels a media stream carries to the classifier. In production
 * these come from AMD + STT (Vosk/Whisper); in simulation they're scripted.
 */
export type AudioLabel =
  | "human_greeting"
  | "ivr_menu"
  | "hold_music"
  | "voicemail_greeting"
  | "silence";

export type OutboundHandle = {
  callId: string;
  /** Async iterator of media events for the call (from answer to hangup). */
  events: AsyncIterable<MediaEvent>;
};

export interface TelephonyProvider {
  /** Place an outbound call. Resolves once dialing starts. */
  placeCall(to: string, from: string): Promise<OutboundHandle>;

  /** Inject DTMF digits into an active call (IVR navigation). No audio, ever. */
  sendDigits(callId: string, digits: string): Promise<void>;

  /**
   * Ring several rep phones simultaneously; resolve with the id of the first to
   * answer, or null if none answer within timeoutMs. A whisper (rep-ear only)
   * may be played to the winning rep — never toward the lead. `callId` is the
   * lead call the reps are being bridged to (identifies the conference).
   */
  ringReps(
    callId: string,
    repPhones: { repId: string; phone: string }[],
    timeoutMs: number,
    whisper?: string,
  ): Promise<{ repId: string } | null>;

  /** Bridge the lead call to the answered rep leg. */
  bridge(callId: string, repId: string): Promise<void>;

  /**
   * Hang up any rep legs rung for this call WITHOUT ending the lead call. Used to
   * release a pre-rung (parked) rep when the call turns out not to be a human
   * (voicemail/dead), so the rep isn't left alone in the conference.
   */
  releaseReps(callId: string): Promise<void>;

  /** Tear down a call. */
  hangup(callId: string): Promise<void>;
}
