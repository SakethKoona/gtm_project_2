# System Overview (as built)

All 8 phases from `IMPLEMENTATION_PLAN.md` are implemented and verified. This
documents what exists and how to run it.

## What's real vs. simulated

| Concern | Status |
|---|---|
| Lead ingestion + validation gate | **Real**, end-to-end |
| Consent ledger, campaigns, pre-dial compliance gate | **Real**, end-to-end |
| Call state machine, IVR navigator, hand-off, governor, abandonment, metrics | **Real logic** — runs against either provider |
| Telephony provider | **Both**: a `SimulatedTelephonyProvider` (default, $0) AND a real `TwilioTelephonyProvider` |
| Carrier calls | **Real calls supported** — set the Twilio env and the always-on server dials for real. See `TELEPHONY_RUNBOOK.md`. |
| Live IVR STT (Deepgram) | Interface ready; Deepgram websocket left as a marked TODO. AMD covers human/voicemail without it. |

The dialer is a **factory switch** (`src/lib/telephony/factory.ts`): with Twilio
env present it places real calls; without it, it simulates. Real calls run
through the **always-on telephony server** (`telephony-server/server.ts`) which
hosts the Twilio webhooks + Media Stream websocket and runs the orchestrator in
process. **💲 carrier minutes** once live.

## Run it

```bash
createdb sales_automation          # once
npm install
npm run db:migrate
npm run seed:suppression           # optional test opt-out numbers
npm run dev                        # http://localhost:3000
```

- **`/`** — lead ingestion wizard (upload → map → pre-import report → commit).
- **`/dashboard`** — create a campaign, assign eligible leads, add reps, toggle
  presence, and **Run simulated batch** to watch live screen-pops, call-state
  changes, and governor snapshots stream in over SSE.

Headless end-to-end simulation (no browser):

```bash
npx tsx --env-file=.env scripts/simulate.ts
```

Prints four verified scenarios: full campaign run (governor caps concurrency),
pre-dial compliance blocks, IVR menu-map learning, and abandonment auto-tightening
OVERDIAL_RATIO.

**Real calls** (needs a Twilio account + a public tunnel + a phone to answer):

```bash
# fill TWILIO_* + PUBLIC_URL in .env (see .env.example), then:
npm run telephony     # always-on webhook + Media Stream server on :4000
# seed a campaign/rep/lead via the dashboard, then trigger:
curl -X POST localhost:4000/dial/campaign -H 'Content-Type: application/json' \
  -d '{"campaignId":"<id>"}'
```

Full step-by-step in **`TELEPHONY_RUNBOOK.md`**.

## Module map

```
src/lib/
  ingestion/        Phase 1: parse, phone→E.164, timezone, DNC seam, consent
                    classification, the shared validation gate, report/commit
  compliance/
    predial.ts      Phase 2: dial-time gate — eligibility, consent, DNC recheck,
                    calling-hours (local time), frequency cap, cooldown, opt-out
  campaigns/
    service.ts      Phase 2: campaign/rep CRUD, freeReps, lead assignment
  telephony/
    provider.ts     TelephonyProvider interface (place call, DTMF, ring, bridge)
    simulated.ts    Simulated provider + scenario library (NO audio to lead)
    scenario-mix.ts deterministic scenario resolver for demos
    twilio.ts       REAL Twilio provider (conference bridge, silent hold, AMD)
    factory.ts      switch: Twilio when creds present, else Simulated
    registry.ts     in-process call registry (media events + rep-answer race)
    async-queue.ts  push→pull bridge (Twilio callbacks → orchestrator events)
  classifier/
    index.ts        Phase 4: media events → RINGING|IVR_MENU|ON_HOLD|HUMAN|…
  ivr/
    navigator.ts    Phase 7: menu parsing, digit scoring, menu-map reinforcement
  dialer/
    orchestrator.ts Phase 3: per-call state machine (drives classifier+navigator+handoff)
    handoff.ts      Phase 5: simultaneous rep ring, first-answer bridge, screen-pop
    governor.ts     Phase 6: concurrency cap = freeReps * OVERDIAL_RATIO
    abandonment.ts  Phase 6: rolling 30-day rate, auto-tighten ratio (FCC ≤3%)
    engine.ts       campaign dialer loop tying gate + governor + orchestrator
    events.ts       in-process pub/sub for live dashboard (Redis in prod)
  observability/
    metrics.ts      Phase 8: dials/min, human-reach, time-to-human, abandonment…
  pipeline/
    service.ts      lead pipeline: list/detail, setStage, logOutcome, follow-ups
    ledger.ts       contact_ledger read/write (recordFound/Called, phonesInLedger)

src/app/
  page.tsx                       ingestion wizard
  dashboard/page.tsx             live dialer dashboard
  pipeline/page.tsx              lead pipeline: table + chat-bubble timeline + follow-ups
  api/ingest/{upload,validate,commit}
  api/campaigns/...              CRUD, snapshot, reps, assign-leads, events(SSE), simulate
  api/leads/...                  list, detail, PATCH stage, POST activity(+follow-up)
  api/followups/...              pending queue, PATCH done|canceled|snooze
```

## Lead pipeline + contact ledger

Every generated lead carries a `pipeline_stage`
(`new → contacted → follow_up → qualified → won | lost | do_not_contact`).
`/pipeline` renders each call as chat-bubble activity (`lead_activities`) with a
prefilled-template composer (`OUTCOME_TEMPLATES` in `config.ts`) and a follow-up
due queue (`follow_ups`). `logOutcome` is one transaction: insert the activity,
move the stage (explicit > template > unchanged), set disposition/lastContacted,
optionally schedule a follow-up; the `do_not_call` template also calls
`recordOptOut()`. Console call finalize maps rep disposition → template and logs
the outcome inline.

`contact_ledger` (migration `0004`) is the permanent found/called log keyed by
E.164 phone, cross-session and independent of the lead row's lifecycle:

- **Ingest** marks ledger-known phones `duplicate`; `commitBatch` upserts a
  ledger row per eligible inserted lead (never re-found).
- **Pre-dial** `checkDialable` denies `already_contacted` when `callCount > 0`,
  unless a `pending` `call` follow-up is due — the queue is the only re-dial
  path (never accidentally re-called).
- **Dial-release** (`engine.ts`) and manual console inserts write the "called"
  ledger row; a completing call clears its matching pending call follow-up.

## Production deployment shape (unchanged from plan)

- **Vercel-native half**: ingestion + dashboard + DB-facing API (Next.js).
- **Always-on half**: the `dialer/` engine + real `TelephonyProvider` run as a
  separate long-lived service (Fly/Railway/VPS), because Media Streams need
  persistent websockets and the governor needs a long-lived worker loop. The
  in-repo `dialer/` modules move there wholesale; `events.ts` swaps to Redis
  pub/sub and `governor.ts` to BullMQ/Redis counters. **💲 always-on host.**

## Hard constraints honored

- **No synthesized audio to the lead**: the provider interface has no
  "play audio to lead" primitive — only DTMF injection and bridging. Whisper is
  rep-ear only.
- **Compliance gates every dial**: `checkDialable` runs before any release; a
  failed check never leaves the queue; every decision is logged to `audit_log`.
- **Abandonment governed**: concurrency capped at `freeReps * OVERDIAL_RATIO`,
  auto-tightened toward the FCC ≤3% target.
- **DNC still stubbed**: external registry is a no-op seam; internal suppression
  is real. A real DNC provider must be wired before any live campaign.
