# Sales Automation — Parallel Dialer + IVR-Escape Tool

Implementation of the spec in [`specs.md`](./specs.md), sequenced by
[`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md).

**Status: all 8 phases built and verified.** The telephony half (Phases 3–7) runs
against a **simulated** telephony provider — the orchestration is real and tested
end-to-end without a carrier. See **`SYSTEM_OVERVIEW.md`** for the as-built
architecture, module map, and how to run the dashboard + simulation.

Two entry points:
- **`/`** — lead ingestion wizard (this file's focus below).
- **`/dashboard`** — live dialer dashboard; **`npm run sim`** runs a headless
  end-to-end simulation.

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
