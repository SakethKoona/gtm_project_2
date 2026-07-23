import { config } from "dotenv";
// Load .env.local first (Google Sheets service-account creds live there, like the
// Next app), then .env (DB + Twilio). dotenv never overrides already-set vars.
config({ path: ".env.local" });
config();

import Fastify from "fastify";
import formbody from "@fastify/formbody";
import websocket from "@fastify/websocket";
import twilio from "twilio";

import { getSession } from "../src/lib/telephony/registry";
import {
  getTelephonyProvider,
  isTelephonyConfigured,
} from "../src/lib/telephony/factory";
import { runCampaignDialer } from "../src/lib/dialer/engine";
import { HeuristicClassifier } from "../src/lib/classifier";
import { getSTT } from "../src/lib/classifier/stt";
import { heartbeat, isServiceEnabled } from "../src/lib/services";

/**
 * Always-on telephony service (the "separate service" from the plan).
 *
 * Hosts every Twilio webhook + the Media Stream websocket, and runs the dialer
 * engine in-process so provider callbacks feed the orchestrator's state machine.
 * Must be publicly reachable (PUBLIC_URL) so Twilio can hit it — use a tunnel
 * (ngrok) in dev. See TELEPHONY_RUNBOOK.md.
 */

const PORT = Number(process.env.TELEPHONY_PORT ?? 4000);
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/$/, "");
const WSS_URL = PUBLIC_URL.replace(/^http/, "ws");

const client =
  process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;

const app = Fastify({ logger: true });

const xml = (reply: import("fastify").FastifyReply, body: string) =>
  reply.header("Content-Type", "text/xml").send(body);

// All plugin registration + routes + listen happen inside main() so the
// websocket plugin is fully registered BEFORE the ws route is declared (tsx
// compiles to CJS, so top-level await isn't available).
async function main() {
  await app.register(formbody);
  await app.register(websocket);

// ── TwiML: on answer, fork media to our ws + park the lead in a SILENT conference
app.post("/twiml/outbound", async (req, reply) => {
  const q = req.query as { conf?: string; rejoin?: string };
  const conf = q.conf ?? "";
  // <Start><Stream> forks media (listen-only); <Dial><Conference> parks the lead.
  // waitUrl → silence: no hold music, no TTS ever reaches the lead.
  return xml(
    reply,
    `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="${WSS_URL}/media"/>
  </Start>
  <Dial>
    <Conference startConferenceOnEnter="true" endConferenceOnExit="false"
                beep="false" muted="false" waitUrl="${PUBLIC_URL}/twiml/silence">
      ${conf}
    </Conference>
  </Dial>
</Response>`,
  );
});

// Silence hold audio for the parked lead — honors "no audio toward the lead".
app.all("/twiml/silence", async (_req, reply) =>
  xml(
    reply,
    `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Pause length="3600"/></Response>`,
  ),
);

// Rep leg: whisper (rep-ear only) THEN join the same conference to bridge.
app.post("/twiml/rep-join", async (req, reply) => {
  const q = req.query as { conf?: string; whisper?: string };
  const whisper = q.whisper ? `<Say>${escapeXml(q.whisper)}</Say>` : "";
  return xml(
    reply,
    `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${whisper}
  <Dial>
    <Conference startConferenceOnEnter="true" endConferenceOnExit="true" beep="false">
      ${q.conf ?? ""}
    </Conference>
  </Dial>
</Response>`,
  );
});

// ── AMD result → HUMAN / VOICEMAIL event into the call's state machine.
//
// Twilio AMD returns: "human", "machine_start"/"machine_end_*", "fax", "unknown".
// We only hang up on a CONFIRMED machine (a real voicemail greeting). "unknown"
// means AMD couldn't decide — we give the benefit of the doubt and CONNECT,
// because dropping a real person is far worse than a rep hearing a voicemail and
// hanging up. This biases the whole system toward reaching live humans.
app.post("/amd", async (req, reply) => {
  const b = req.body as { CallSid?: string; AnsweredBy?: string };
  const session = b.CallSid ? getSession(b.CallSid) : undefined;
  if (session && !session.amdReported) {
    session.amdReported = true;
    const answeredBy = b.AnsweredBy ?? "unknown";
    const isMachine = answeredBy.startsWith("machine") || answeredBy === "fax";
    app.log.info(`AMD for ${b.CallSid}: answeredBy=${answeredBy} → ${isMachine ? "VOICEMAIL" : "HUMAN"}`);
    session.events.push(
      isMachine
        ? { type: "audio", label: "voicemail_greeting" }
        : { type: "audio", label: "human_greeting" },
    );
  }
  return reply.send("ok");
});

// ── Lead call status.
//  - Connect-on-answer mode: the instant the call is answered ("in-progress"),
//    emit HUMAN so the orchestrator bridges a rep immediately — no AMD wait. This
//    is the fastest possible time-to-human (just ring time).
//  - On completion/no-answer/busy/failed: close the session (ends its stream).
const CONNECT_ON_ANSWER = process.env.DIAL_CONNECT_ON_ANSWER === "true";
app.post("/status", async (req, reply) => {
  const b = req.body as { CallSid?: string; CallStatus?: string };
  const session = b.CallSid ? getSession(b.CallSid) : undefined;

  if (b.CallStatus === "in-progress" && session) {
    // Lead answered. Tell the orchestrator so it can pre-ring a rep into the
    // conference NOW — in parallel with AMD / IVR navigation — so the rep is
    // already parked when a human is reached (near-zero customer silence).
    if (!session.answeredReported) {
      session.answeredReported = true;
      session.events.push({ type: "answered" });
    }
    // Connect-on-answer: also bridge immediately (no AMD wait).
    if (CONNECT_ON_ANSWER && !session.amdReported) {
      session.amdReported = true; // so a stray AMD callback can't double-fire
      app.log.info(`connect-on-answer: bridging ${b.CallSid} on answer (no AMD)`);
      session.events.push({ type: "audio", label: "human_greeting" });
    }
  }

  if (
    session &&
    (b.CallStatus === "completed" ||
      b.CallStatus === "no-answer" ||
      b.CallStatus === "busy" ||
      b.CallStatus === "failed")
  ) {
    session.events.push({ type: "hangup" });
  }
  return reply.send("ok");
});

// ── Rep leg status: first "answered" wins the race; hang up the losers.
app.post("/rep-status", async (req, reply) => {
  const q = req.query as { leadCallSid?: string; repId?: string };
  const b = req.body as { CallSid?: string; CallStatus?: string };
  if (b.CallStatus === "in-progress" || b.CallStatus === "answered") {
    const session = q.leadCallSid ? getSession(q.leadCallSid) : undefined;
    const race = session?.repRace;
    if (session && race && !race.settled && q.repId) {
      race.resolve({ repId: q.repId });
      // Hang up every other rep leg that was rung.
      for (const [repCallSid] of race.repCallSids) {
        if (repCallSid !== b.CallSid) {
          client?.calls(repCallSid).update({ status: "completed" }).catch(() => {});
        }
      }
    }
  }
  return reply.send("ok");
});

// ── Media Stream websocket: audio frames → STT → classifier → call events.
app.get("/media", { websocket: true }, (socket) => {
  let callSid: string | null = null;
  const classifier = new HeuristicClassifier();
  const stt = getSTT();

  stt?.onTranscript((text) => {
    if (!callSid) return;
    const c = classifier.classify({ type: "audio", label: "silence", transcript: text });
    // Heuristic fallback path returns IVR_MENU/ON_HOLD/etc from the transcript.
    if (c && callSid) {
      const session = getSession(callSid);
      if (c.state === "IVR_MENU")
        session?.events.push({ type: "audio", label: "ivr_menu", transcript: text });
      else if (c.state === "ON_HOLD")
        session?.events.push({ type: "audio", label: "hold_music" });
      else if (c.state === "VOICEMAIL")
        session?.events.push({ type: "audio", label: "voicemail_greeting", transcript: text });
    }
  });

  socket.on("message", (raw: Buffer) => {
    const msg = JSON.parse(raw.toString());
    if (msg.event === "start") {
      callSid = msg.start?.callSid ?? null;
    } else if (msg.event === "media") {
      stt?.pushAudio(msg.media?.payload);
    } else if (msg.event === "stop") {
      stt?.close();
    }
  });
  socket.on("close", () => stt?.close());
});

// One dialer run per campaign at a time. The run drains all currently-dialable
// leads (re-querying mid-run) and exits during a lull; the sheet poller restarts
// it when new leads arrive.
const activeDialers = new Set<string>();
function ensureDialer(campaignId: string): boolean {
  if (activeDialers.has(campaignId)) return false;
  if (!isTelephonyConfigured()) return false;
  const { provider } = getTelephonyProvider();
  activeDialers.add(campaignId);
  void runCampaignDialer({
    provider,
    campaignId,
    fromNumber: process.env.TWILIO_NUMBER!,
    talkTimeMs: 1500,
  })
    .catch((e) => app.log.error(e))
    .finally(() => activeDialers.delete(campaignId));
  return true;
}

// ── Trigger real dialing for a campaign via Twilio.
app.post("/dial/campaign", async (req, reply) => {
  const b = req.body as { campaignId?: string };
  if (!b.campaignId) return reply.code(400).send({ error: "campaignId required" });
  if (!isTelephonyConfigured()) {
    return reply.code(503).send({
      error: `Telephony not configured. Missing: ${telephonyMissing().join(", ")}.`,
    });
  }
  if (!(await isServiceEnabled("telephony"))) {
    return reply.code(409).send({
      error: "Dialing is paused. Turn the Telephony service on in the Services panel.",
    });
  }
  const { mode } = getTelephonyProvider();
  const started = ensureDialer(b.campaignId);
  return reply.send({ started, alreadyRunning: !started, mode });
});

  app.get("/health", async () => ({
    ok: true,
    configured: isTelephonyConfigured(),
    publicUrl: PUBLIC_URL,
    wss: WSS_URL,
  }));

  // ── Preflight: report exactly what's configured so a misconfig is obvious.
  const missing = telephonyMissing();
  if (missing.length === 0) {
    app.log.info(`✅ Twilio configured. Dialing FROM ${process.env.TWILIO_NUMBER}`);
    app.log.info(`PUBLIC_URL=${PUBLIC_URL}  (Twilio must be able to reach this)`);
    if (!/^https:\/\//.test(PUBLIC_URL)) {
      app.log.warn(
        `⚠️  PUBLIC_URL is not https — Twilio webhooks + Media Streams require a public https URL (use an ngrok https URL).`,
      );
    }
  } else {
    app.log.warn(
      `⚠️  Twilio NOT configured — dialing is disabled. Missing env: ${missing.join(", ")}. ` +
        `Set these in .env and restart to place real calls.`,
    );
  }

  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`telephony server on :${PORT}`);
  app.log.info(
    `ℹ️  Dialing is on-demand (hit "Dial" in the dashboard). Sheet ingestion is a ` +
      `separate service — run \`npm run ingest\`.`,
  );

  // Heartbeat so the admin Services panel shows this process as alive.
  const beat = () =>
    void heartbeat("telephony", {
      configured: isTelephonyConfigured(),
      activeDialers: activeDialers.size,
    }).catch((e) => app.log.error(e));
  beat();
  setInterval(beat, 20000);
}

function telephonyMissing(): string[] {
  return [
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_NUMBER",
    "PUBLIC_URL",
  ].filter((k) => !process.env[k]);
}

function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!,
  );
}

main().catch((e) => {
  app.log.error(e);
  process.exit(1);
});

process.on("SIGINT", () => process.exit(0));
