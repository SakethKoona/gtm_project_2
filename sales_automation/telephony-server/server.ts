import { config } from "dotenv";
config();

import Fastify from "fastify";
import formbody from "@fastify/formbody";
import websocket from "@fastify/websocket";
import twilio from "twilio";

import { getSession } from "../src/lib/telephony/registry";
import { getTelephonyProvider } from "../src/lib/telephony/factory";
import { runCampaignDialer } from "../src/lib/dialer/engine";
import { HeuristicClassifier } from "../src/lib/classifier";
import { getSTT } from "../src/lib/classifier/stt";

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
  const whisper = q.whisper
    ? `<Say>${escapeXml(decodeURIComponent(q.whisper))}</Say>`
    : "";
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
app.post("/amd", async (req, reply) => {
  const b = req.body as { CallSid?: string; AnsweredBy?: string };
  const session = b.CallSid ? getSession(b.CallSid) : undefined;
  if (session && !session.amdReported) {
    session.amdReported = true;
    const human = b.AnsweredBy === "human";
    session.events.push(
      human
        ? { type: "audio", label: "human_greeting" }
        : { type: "audio", label: "voicemail_greeting" },
    );
  }
  return reply.send("ok");
});

// ── Lead call status: on completion, close the session (ends its event stream).
app.post("/status", async (req, reply) => {
  const b = req.body as { CallSid?: string; CallStatus?: string };
  if (b.CallSid && (b.CallStatus === "completed" || b.CallStatus === "no-answer" || b.CallStatus === "busy" || b.CallStatus === "failed")) {
    const session = getSession(b.CallSid);
    session?.events.push({ type: "hangup" });
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

// ── Trigger real dialing for a campaign (uses the real provider when configured).
app.post("/dial/campaign", async (req, reply) => {
  const b = req.body as { campaignId?: string };
  if (!b.campaignId) return reply.code(400).send({ error: "campaignId required" });
  const { provider, mode } = getTelephonyProvider();
  void runCampaignDialer({
    provider,
    campaignId: b.campaignId,
    fromNumber: process.env.TWILIO_NUMBER ?? "+15550000000",
    talkTimeMs: 1500,
  }).catch((e) => app.log.error(e));
  return reply.send({ started: true, mode });
});

  app.get("/health", async () => ({ ok: true, publicUrl: PUBLIC_URL, wss: WSS_URL }));

  const { mode } = getTelephonyProvider();
  app.log.info(`Telephony provider mode: ${mode}`);
  app.log.info(`PUBLIC_URL=${PUBLIC_URL}  (Twilio must be able to reach this)`);

  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`telephony server on :${PORT}`);
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
