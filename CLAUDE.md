# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository shape

This is a **GTM (go-to-market) platform** — a single Next.js 16 app in
`sales_automation/` (the repo root holds only `CLAUDE.md`, `LICENSE`, and that app).
**`cd sales_automation` before running any command.** The app's own `CLAUDE.md` is
just `@AGENTS.md`.

The app has three sections behind one left-nav shell (`src/components/app-shell.tsx`):
- **Leads / Ingestion** (`/`) — upload → map → pre-import report → commit wizard.
- **Dialer Dashboard** (`/dashboard`) — campaigns, reps, live dialer.
- **Call Console** (`/console`) — the rep's per-call stopwatch (formerly a separate
  "time tracker" app, now merged in). It has two modes: **dialer mode** (pick a rep;
  calls bridge in via screen-pop and persist to Postgres) and **solo mode** (no rep,
  no DB — calls saved to `localStorage`, like a standalone stopwatch). The seam is
  `SOLO_REP_ID` in `src/hooks/useCallTracker.ts`.

> History note: this used to be two separate apps (`sales_automation` +
> `automated_time_tracker`). They were consolidated into `sales_automation`; the
> tracker lives at `/console`. Don't recreate the second app.

## Critical: Next.js 16

Runs **Next.js 16.2.10** (App Router, React 19). This is **not** the Next.js in your
training data — APIs, conventions, and file structure may differ, and there are
breaking changes. Before writing Next.js code, read the relevant guide in
`node_modules/next/dist/docs/` and heed deprecation notices (the standing instruction
in `AGENTS.md`).

## Commands

Run inside `sales_automation/`:

```bash
npm run dev            # dev server on http://localhost:3000
npm run build          # production build
npm run lint           # eslint
npm run db:generate    # generate a Drizzle migration after editing src/db/schema.ts
npm run db:migrate     # apply migrations
npm run db:studio      # Drizzle Studio
npm run telephony      # always-on Twilio webhook + Media Stream server on :4000
```

There is **no test runner**, and the simulation harness has been removed — the dialer
is **Twilio-only** (real calls). The `scripts/` directory is intentionally empty.

### First-time setup

Needs a local Postgres. `DATABASE_URL` lives in `.env` (git-ignored; see `.env.example`).
Google Sheets sync credentials (below) live in `.env.local`.

```bash
createdb sales_automation
npm install
npm run db:migrate
npm run dev
```

## Architecture

Built in 8 phases (see `specs.md` / `IMPLEMENTATION_PLAN.md` / `SYSTEM_OVERVIEW.md`).
The core split is **compliance-gated ingestion + dashboard + console (Vercel-native)**
vs. an **always-on telephony/dialer engine** that needs persistent websockets and a
long-lived worker loop.

Two invariants shape the whole design — respect them when changing telephony code:
- **No synthesized audio is ever played to the lead.** The `TelephonyProvider`
  interface (`src/lib/telephony/provider.ts`) deliberately has no "play audio to lead"
  primitive — only DTMF injection and bridging. Whisper/screen-pop is rep-ear only.
- **Every dial passes the compliance gate.** `checkDialable`
  (`src/lib/compliance/predial.ts`) runs before any call is released; a failed check
  never leaves the queue, and every decision writes to `audit_log`.

Key seams:
- **The shared ingestion gate** — `src/lib/ingestion/service.ts` (`LeadIngestionService`)
  is the single validation-and-scrub entry point every ingestion path must use (phone
  → E.164, consent classification, DNC, timezone, dedupe, audit). **Do not reimplement
  validation per path.**
- **Provider factory** — `src/lib/telephony/factory.ts` returns the real
  `TwilioTelephonyProvider`, or **throws** if Twilio env is missing (no simulated
  fallback — the simulation subsystem was removed). `isTelephonyConfigured()` is the
  preflight check. Dialing is real Twilio only.
- **DNC is stubbed** — external National/state registry is a deliberate no-op seam
  (`src/lib/ingestion/dnc.ts`); the internal suppression list is real. A real DNC
  provider **must** be wired before any live campaign.
- **In-process pub/sub** — `src/lib/dialer/events.ts` and `telephony/registry.ts` are
  in-process today (SSE to the dashboard); they swap to Redis/BullMQ in the always-on
  production host.

Module map (`src/lib/`): `ingestion/` (parse, validate, commit) · `compliance/predial.ts` ·
`campaigns/service.ts` · `telephony/` (provider interface, simulated + twilio, factory,
registry) · `classifier/` (media events → call state) · `ivr/navigator.ts` (menu-map
learning) · `dialer/` (orchestrator state machine, handoff, governor, abandonment,
engine loop) · `observability/metrics.ts`. Call Console pieces: `hooks/useCallTracker.ts`
(timer state machine + solo/DB split), `components/tracker-provider.tsx` (context +
global keys + rep event stream), `components/{bucket-grid,history-table,stat-cards,
disposition-dialog,rep-picker,sync-panel}.tsx`, `lib/{config,storage,format,stats,csv}.ts`.

The always-on server is `telephony-server/server.ts` (Fastify): hosts Twilio webhooks +
Media Stream websocket and runs the orchestrator in-process. See `TELEPHONY_RUNBOOK.md`.

## Google Sheets sync

The Call Console can append every finished call to a Google Sheet. The browser POSTs to
`/api/sheets` (`src/app/api/sheets/route.ts`), which writes via a Google **service
account** using the Sheets REST API — no SDK, no OAuth for the user (`src/lib/
sheets-server.ts`; client shim `src/lib/sheets.ts`; panel `src/components/sync-panel.tsx`).
Users paste a normal Sheet link. Credentials (`GOOGLE_SERVICE_ACCOUNT_EMAIL`,
`GOOGLE_PRIVATE_KEY`) live in `.env.local`; setup in `SHEETS_SETUP.md`. Rows are de-duped
by call `id`, so re-syncing is idempotent. (A dormant legacy Apps Script path also exists
in `google-apps-script.gs` + the `SHEET_WEBHOOK_URL` branch of `/api/console/calls`.)
