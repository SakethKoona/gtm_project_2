# GTM Console

Go-to-market tooling for outbound sales. The repo now ships **one unified
frontend — GTM Console** ([`sales_automation/`](./sales_automation)) — a
Next.js + TypeScript app that puts the whole rep + admin workflow behind a
single cobalt-railed shell:

| Surface | Route | What it is |
|---------|-------|------------|
| **Leads** | `/` | Lead ingestion wizard — upload → map columns → pre-dial compliance report → commit. |
| **Call console** | `/console` | Keyboard-driven live call console (the former standalone time tracker): one running timer, six state buckets, dispositions, aggregate stats, server-backed history. Dialer screen-pop auto-starts the timer on a bridged call. |
| **Pipeline** | `/pipeline` | Lead management workspace — stageed lead table, per-lead activity timeline, outcome composer, and a follow-up queue. |
| **Dialer dashboard** | `/dashboard` | Admin dialer ops — KPI tiles, rep presence, live SSE call feed, campaign controls, and FCC abandonment governance. |

The [`automated_time_tracker/`](./automated_time_tracker) app is retained as the
**legacy standalone tracker** — the prototype the `/console` surface was built
from. It is **superseded by `/console`** and kept only for reference / offline
standalone use.

## Quick start

GTM Console needs a local Postgres. A `docker-compose.yml` brings one up on
port **5433**.

```bash
cd sales_automation

# 1. start Postgres (docker) on localhost:5433
docker compose up -d

# 2. point .env at it
#    DATABASE_URL=postgres://sales:sales@localhost:5433/sales_automation

# 3. install deps
npm install

# 4. apply schema
npm run db:migrate

# 5. run
npm run dev            # http://localhost:3000
```

Requires Node 20+. The telephony half runs in `$0` simulation mode by default —
no carrier required. See [`sales_automation/README.md`](./sales_automation/README.md)
for details and alternative (Homebrew) Postgres setup.

## Documentation

- [`sales_automation/README.md`](./sales_automation/README.md) — the unified
  frontend, its four surfaces, setup, and the lead-ingestion pipeline
- [`sales_automation/SYSTEM_OVERVIEW.md`](./sales_automation/SYSTEM_OVERVIEW.md) —
  as-built architecture and module map
- [`sales_automation/TELEPHONY_RUNBOOK.md`](./sales_automation/TELEPHONY_RUNBOOK.md) —
  placing real calls through Twilio
- [`sales_automation/specs.md`](./sales_automation/specs.md) and
  [`IMPLEMENTATION_PLAN.md`](./sales_automation/IMPLEMENTATION_PLAN.md) — original
  spec and phase plan
- [`automated_time_tracker/README.md`](./automated_time_tracker/README.md) —
  the legacy standalone tracker (superseded by `/console`)
- [`automated_time_tracker/SHEETS_SETUP.md`](./automated_time_tracker/SHEETS_SETUP.md) —
  Google Sheets live-sync setup for the standalone tracker

## Legal / compliance disclaimer

The dialer implements safeguards (consent ledger, pre-dial compliance gate,
calling-hours and frequency caps, opt-out suppression, abandonment-rate
governance targeting the FCC ≤3% rule), but **the external DNC registry check
is a stubbed no-op** and nothing here constitutes legal advice. Outbound
calling is heavily regulated (TCPA, TSR, and state law in the US; equivalents
elsewhere). You are solely responsible for ensuring any real campaign you run
with this software complies with the laws that apply to you — including wiring
a real DNC provider before going live. See the "Hard constraints" section of
`sales_automation/SYSTEM_OVERVIEW.md`.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

MIT — see [`LICENSE`](./LICENSE). Copyright (c) 2026 Saketh Koona, Aneesh Iyer.
