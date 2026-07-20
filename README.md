# GTM Project

Go-to-market tooling for outbound sales: a compliance-gated parallel dialer and
a rep-facing call time tracker. Two independent Next.js + TypeScript apps live
in this repo:

| App | What it is |
|-----|------------|
| [`sales_automation/`](./sales_automation) | Outbound dialer platform — lead ingestion, pre-dial compliance gating, parallel dialing (simulated or real via Twilio), IVR navigation, rep hand-off, FCC abandonment governance, live dashboard. |
| [`automated_time_tracker/`](./automated_time_tracker) | Keyboard-driven call console/stopwatch that breaks down where a rep's call time goes, with dispositions, stats, CSV export, and optional Google Sheets sync. |

The apps are not yet wired together, but the time tracker is designed as the
rep workstation the dialer will eventually hand bridged calls off to.

## Quick start

Each app is self-contained — `cd` in and follow its README:

```bash
# Call time tracker (no external services needed)
cd automated_time_tracker
npm install
npm run dev            # http://localhost:3000

# Sales automation (needs local Postgres; runs in $0 simulation mode by default)
cd sales_automation
createdb sales_automation
npm install
npm run db:migrate
npm run dev            # http://localhost:3000
```

Requires Node 20+.

## Documentation

- [`sales_automation/README.md`](./sales_automation/README.md) — setup and the
  lead-ingestion pipeline
- [`sales_automation/SYSTEM_OVERVIEW.md`](./sales_automation/SYSTEM_OVERVIEW.md) —
  as-built architecture and module map
- [`sales_automation/TELEPHONY_RUNBOOK.md`](./sales_automation/TELEPHONY_RUNBOOK.md) —
  placing real calls through Twilio
- [`sales_automation/specs.md`](./sales_automation/specs.md) and
  [`IMPLEMENTATION_PLAN.md`](./sales_automation/IMPLEMENTATION_PLAN.md) — original
  spec and phase plan
- [`automated_time_tracker/README.md`](./automated_time_tracker/README.md) —
  usage, keyboard shortcuts, and project structure
- [`automated_time_tracker/SHEETS_SETUP.md`](./automated_time_tracker/SHEETS_SETUP.md) —
  Google Sheets live-sync setup

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
