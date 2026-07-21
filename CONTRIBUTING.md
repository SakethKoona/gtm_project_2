# Contributing

Thanks for your interest! Issues and pull requests are welcome.

## Ground rules

- Open an issue first for anything beyond a small fix so we can agree on the
  approach.
- Keep changes scoped to one of the two apps unless the change is genuinely
  cross-cutting.
- By contributing, you agree your contributions are licensed under the
  repository's [MIT License](./LICENSE).

## Development setup

Each app has its own `package.json` and README with setup instructions:

- `automated_time_tracker/` — plain Next.js app, `npm install && npm run dev`.
- `sales_automation/` — needs a local Postgres (`createdb sales_automation`,
  then `npm run db:migrate`). It runs in a free simulation mode by default;
  never commit real Twilio/Deepgram credentials — use `.env` (gitignored),
  and keep `.env.example` up to date when adding new configuration.

Both apps pin a recent Next.js (16.x) whose conventions differ from older
releases — see each app's `AGENTS.md` note and consult
`node_modules/next/dist/docs/` when in doubt.

## Before opening a PR

- `npm run lint` passes in the app(s) you touched.
- `npm run build` succeeds.
- For `sales_automation` dialer/compliance changes, run the headless
  simulation (`npm run sim` / `npx tsx --env-file=.env scripts/simulate.ts`)
  and confirm the scenarios still pass.
- Database schema changes go through Drizzle migrations
  (`npm run db:generate`), never hand-edited SQL in `drizzle/`.

## Compliance-sensitive areas

Changes under `sales_automation/src/lib/compliance/`, `dialer/governor.ts`,
`dialer/abandonment.ts`, or the ingestion consent/DNC logic affect regulatory
safeguards. PRs touching these must explain how the guarantees in
`SYSTEM_OVERVIEW.md` ("Hard constraints honored") are preserved.
