# GTM Console — Unified Frontend

The one unified frontend for outbound GTM: lead ingestion, a keyboard-driven
call console, a lead pipeline, and the admin dialer dashboard — all behind a
single cobalt-railed shell. Implementation of the spec in [`specs.md`](./specs.md),
sequenced by [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md).

**Status: all 8 phases built and verified.** The telephony half (Phases 3–7) runs
against a **simulated** telephony provider — the orchestration is real and tested
end-to-end without a carrier. See **`SYSTEM_OVERVIEW.md`** for the as-built
architecture, module map, and how to run the dashboard + simulation.

## The four surfaces

Every route lives under the same nav shell:

- **`/` — Leads** — the lead ingestion wizard (this file's focus below).
- **`/console` — Call console** — the keyboard-driven live call console. This
  surface **absorbed the standalone call time tracker** (`../automated_time_tracker`):
  the timer state machine, the `1`–`6`/`Space`/`0`/`Enter` shortcuts, the
  disposition tagging, aggregate stat tiles, CSV export, Google Sheets sync, and
  history management all come from it. History is now server-backed (per rep,
  via `/api/console/calls`) and a bridged call from the dialer screen-pops the
  console and auto-starts the timer.
- **`/pipeline` — Pipeline** — lead management workspace (see below).
- **`/dashboard` — Dialer dashboard** — admin dialer ops console; **`npm run sim`**
  runs a headless end-to-end simulation.

### Design system

The app uses a lightweight **design system** — Montserrat headings, IBM Plex Mono
for numerics/labels, and a single cobalt accent on quiet white cards.

## Stack (Phase 1)

- Next.js 16 (App Router) + TypeScript + Tailwind — dashboard & API
- Postgres via Drizzle ORM
- `csv-parse` (streaming) + `xlsx` — file parsing
- `libphonenumber-js` — phone E.164 normalization/validation

All free / open-source. See `IMPLEMENTATION_PLAN.md` for the cost breakdown of
later phases (carrier minutes, STT compute, etc.).

## Prerequisites

- Node 20+
- A local Postgres (Homebrew `postgresql@17` or similar). A `docker-compose.yml`
  is included as an alternative — uncomment the matching `DATABASE_URL` in `.env`.

## Setup

```bash
# 1. create the database (if using local Homebrew Postgres)
createdb sales_automation

# 2. install deps
npm install

# 3. point .env at your DB (defaults to postgres://<user>@localhost:5432/sales_automation)

# 4. apply schema
npm run db:migrate

# 5. (optional) seed a couple of internal-suppression numbers for testing the DNC-block path
npm run seed:suppression

# 6. run
npm run dev   # http://localhost:3000
```

## Phase 1 — what works

Open `/` and follow the wizard:

1. **Upload** a `.csv` / `.xlsx` vendor list (stream-parsed).
2. **Map columns** — headers are never assumed; a heuristic pre-fills the mapping,
   and a per-vendor template is remembered for repeat uploads. `phone` and
   `consent_basis` are required.
3. **Pre-import report** — the honest callable count:
   `eligible | quarantined (no consent) | blocked (DNC/suppression) | invalid | duplicates`.
4. **Commit** — only `eligible` rows become dial-eligible; everything else is
   retained with a rejection reason for the audit trail.

### The shared gate

`src/lib/ingestion/service.ts` is the single `LeadIngestionService` gate every
ingestion path must use (CSV is its first caller — do not reimplement per path):

- **Phone** → E.164 via `libphonenumber-js`; invalid rejected.
- **Consent basis** required → missing ⇒ quarantined, never silently imported.
- **DNC** → external National/state scrub is a stubbed no-op seam
  (`src/lib/ingestion/dnc.ts`); the internal suppression list is real. **A real
  DNC provider must be wired before any live campaign** — DNC applies to
  live-human cold calls too.
- **Timezone** → derived from NANP area code when absent, for the later
  calling-hours gate.
- **Dedupe** → within-file and against existing eligible leads.
- Every commit writes an immutable `audit_log` record.

### Layout

```
src/
  db/                     schema.ts (Drizzle), index.ts (client)
  lib/ingestion/
    service.ts            the shared validation-and-scrub gate + report/commit
    phone.ts              E.164 normalization
    timezone.ts           NANP area-code → IANA timezone
    dnc.ts                DncScrubber interface + stub + internal suppression
    parse.ts              streaming CSV / XLSX parsing
    store.ts              temp staging between validate and commit
    types.ts
  app/
    page.tsx              the upload → map → report → commit wizard
    api/ingest/{upload,validate,commit}/route.ts
scripts/                  seed-suppression.ts, sample-leads.csv
```

## Lead Pipeline

`/pipeline` (Rep nav) tracks every generated lead through a stage
(`new → contacted → follow_up → qualified → won | lost | do_not_contact`) and
turns each call into documentation. Left pane: filterable/searchable lead table.
Right pane: a per-lead **activity timeline** rendered as chat bubbles
(rep/outcome bubbles right-aligned, dialer/system bubbles left, stage changes as
centered dividers) with a **composer** — prefilled outcome-template chips plus a
free-text note. Templates that suggest a follow-up reveal an inline scheduler
(call/email, quick date presets). A **follow-up queue** lists pending items by
due date, overdue highlighted, with Done / Snooze / Open-lead actions.

- **Routes:** `GET/POST /api/leads`, `GET/PATCH /api/leads/[id]`,
  `POST /api/leads/[id]/activity` (log outcome + optional follow-up),
  `GET /api/followups`, `PATCH /api/followups/[id]` (done | canceled | snooze).
  Business logic lives in `src/lib/pipeline/{service,ledger}.ts`; routes are thin.
- **Tables** (migration `0004`): `lead_activities` (timeline bubbles),
  `follow_ups` (due queue), `contact_ledger` (dedupe log), plus
  `leads.pipeline_stage`. Outcome vocab is `OUTCOME_TEMPLATES` in
  `src/lib/config.ts`; the `do_not_call` template also calls `recordOptOut()`.

### Contact ledger (the persistent found/called log)

`contact_ledger` is a permanent, cross-session record keyed by E.164 phone, so a
number is never re-found on ingest nor accidentally re-dialed — surviving even if
the original lead row is later quarantined or deleted.

- **Found-side (ingest):** `validateBatch` marks a row `duplicate` when its phone
  is already in the ledger; `commitBatch` upserts a ledger row for every eligible
  inserted lead (`onConflictDoNothing`).
- **Called-side (pre-dial):** `checkDialable` denies `already_contacted`
  (`already_called`) when `callCount > 0` for the phone — **unless** the lead has
  a `pending` `call` follow-up due now. The follow-up queue is the only
  sanctioned re-dial path.
- **Called write:** the dialer records the ledger at guaranteed dial-release
  (`engine.ts`); manual console calls record on their insert path. A completing
  call against a pending call follow-up marks that follow-up `done`.

## DB scripts

```bash
npm run db:generate   # generate a migration after editing schema.ts
npm run db:migrate    # apply migrations
npm run db:studio     # Drizzle Studio
```

## License

MIT — see the repository-root [`LICENSE`](../LICENSE).

**Compliance note:** outbound calling is regulated (TCPA/TSR/state law). The
external DNC registry check is a stubbed no-op; wire a real DNC provider and
verify your legal obligations before running any live campaign. See the
disclaimer in the repository-root README.
