# Telephony Runbook — placing REAL calls

The dialer runs in **simulated mode** by default (no calls, $0). Setting the
Twilio env vars flips it to real outbound calls. This is the exact path to your
first real call.

> **Honesty up front:** this integration is written against Twilio's documented
> API and boots/typechecks cleanly, but it has **not** been run against a live
> Twilio account from this environment (no account, no public tunnel, no phone to
> answer). Expect to debug the first real call — that's normal for Twilio Media
> Streams + conference bridging. The pieces below are what you wire and watch.

## What you need (all 💲 or account setup)

1. A **Twilio account** (trial works to start) → Account SID + Auth Token.
2. A **Twilio phone number** you own (Voice-enabled), in E.164.
3. A **public tunnel** so Twilio can reach your local server:
   `ngrok http 4000` → gives an `https://<id>.ngrok-free.app` URL.
4. A **phone you can answer** (the "lead") and a **second phone** (the "rep").
5. *(Optional)* a **Deepgram key** for live IVR navigation — without it, calls
   still reach a human and bridge, they just can't auto-press menu digits.

Trial accounts can only call **verified** numbers — verify both your test phones
in the Twilio console first.

## Configure

Copy `.env.example` → `.env` and fill:

```
DATABASE_URL=...                       # already set for local dev
TWILIO_ACCOUNT_SID=ACxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxx
TWILIO_NUMBER=+1XXXXXXXXXX              # your Twilio number
PUBLIC_URL=https://<id>.ngrok-free.app # the tunnel URL, no trailing slash
```

## Seed a campaign, a rep (your phone), and a lead (your other phone)

The real dial path uses the same DB + orchestrator. Easiest via the dashboard:

```bash
npm run dev            # http://localhost:3000
```

1. On **`/`**, upload a tiny CSV whose one lead's `phone` is a number you can
   answer, with a valid `consent` value. Commit it.
2. On **`/dashboard`**: create a campaign, **Assign eligible leads**, **+ Rep**
   with your *second* phone as the rep number, and toggle that rep to
   **available**. Set the campaign's calling hours to include "now".

## Start the always-on telephony server + tunnel

```bash
ngrok http 4000        # terminal 1 — copy the https URL into PUBLIC_URL, restart if it changes
npm run telephony      # terminal 2 — logs "Telephony provider mode: twilio"
```

If the log says `mode: simulated`, your TWILIO_* / PUBLIC_URL env isn't loaded.

## Place the call

```bash
curl -X POST http://localhost:4000/dial/campaign \
  -H 'Content-Type: application/json' \
  -d '{"campaignId":"<your-campaign-id>"}'
# → {"started":true,"mode":"twilio"}
```

What happens:
1. Twilio calls your **lead** phone from your Twilio number.
2. On answer, Twilio hits `/twiml/outbound` → forks audio to `/media` and parks
   the lead in a **silent** conference (no audio played to the lead).
3. Twilio **AMD** posts to `/amd` → `human` emits a HUMAN event into the state
   machine (a machine emits VOICEMAIL and the call hangs up).
4. On HUMAN, the hand-off rings your **rep** phone; answering it drops you into
   the same conference — **you're now talking to the lead**. A whisper announces
   the lead in the rep's ear first.
5. The attempt (timeline, disposition, time-to-human) is written to
   `call_attempts`; the dashboard shows the screen-pop + metrics.

## Where to watch / debug

- **Twilio Console → Monitor → Logs → Calls / Errors** — the truth for webhook
  failures, TwiML errors, AMD results.
- **`npm run telephony` logs** — every webhook hit and the provider mode.
- Common first-call issues: `PUBLIC_URL` not matching the current ngrok URL;
  trial number calling an unverified phone; calling-hours gate blocking (check
  the lead's timezone vs. campaign hours); rep not toggled available.

## What's real vs. still stubbed on this path

| Piece | State |
|---|---|
| Outbound call, answer, silent conference park | **Real** (Twilio) |
| Human/voicemail detection | **Real** via Twilio AMD |
| Simultaneous rep ring, first-answer bridge, rep whisper | **Real** (conference) |
| Screen-pop, metrics, compliance gate, governor | **Real** (reused from sim path) |
| Live IVR "press 1" navigation | Needs a `DEEPGRAM_API_KEY` + the STT impl in `src/lib/classifier/stt.ts` (interface ready, Deepgram websocket left as a marked TODO) |
| National/state DNC scrub | Still a stub — wire a real provider before any live campaign |

## Going fully open-source (no Twilio)

The same `TelephonyProvider` interface accepts a FreeSWITCH/Jambonz
implementation instead of Twilio (self-hosted, no per-minute markup — you still
pay a SIP trunk for PSTN). Implement `provider.ts` against Jambonz's webhook API
and point the factory at it; the orchestrator, hand-off, governor, and dashboard
are unchanged.
