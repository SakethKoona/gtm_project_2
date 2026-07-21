# Call Time Tracker

> **Deprecated — superseded by the unified app's `/console`.**
> This standalone tracker has been folded into **Transpira GTM**
> ([`../sales_automation`](../sales_automation)) as the **Call console** surface
> (`/console`), where its timer, keyboard shortcuts, dispositions, stats, CSV
> export, and Sheets sync now live alongside the pipeline and dialer with
> server-backed, per-rep history. It is kept here only for reference and
> standalone/offline use — new work should target `/console`.

A keyboard-driven stopwatch that breaks down where your call time goes — ringing,
waiting/hold, right person, wrong person, voicemail, dead — with exactly one
timer running at a time. Built with **Next.js (App Router) + TypeScript +
Tailwind** so it's ready to expand.

## Run

```bash
npm install
npm run dev      # http://localhost:3000
```

Other scripts: `npm run build` (production build), `npm run lint`.

## How it works

One key switches the running timer; whatever was running banks its time.

| Key | Starts timing… |
|-----|----------------|
| `1` | Ringing / dialing |
| `2` | Waiting room / hold |
| `3` | Right person |
| `4` | Wrong person |
| `5` | Voicemail |
| `6` | No answer / dead |
| `Space` / `0` | Idle (pause between calls) |
| `Enter` | End call → pick a disposition → save & reset |

Press a running bucket's key again to pause it. On end, tag an outcome
(`b`/`c`/`n`/`w`/`x`/`o`) + optional note. History, aggregate stats, and CSV
export are on the page. Everything persists in `localStorage`.

## Google Sheets live sync

Paste a Google Apps Script web-app URL into the sync panel to auto-append each
finished call to a Sheet. One-time setup in **`SHEETS_SETUP.md`** (script in
`google-apps-script.gs`).

## UI

Built with **shadcn/ui** (dark theme) as a single-page **call console** — the
intended rep workstation. Two columns: the **live call** on the left (current-call
clock, six compact state toggles, End-call action) and **recent calls + stats** on
the right. Google Sheet sync lives in a dialog off the header.

The running timer is in a shared context (`tracker-provider`) so the number-key
shortcuts work anywhere and the clock survives re-renders. This is the seam where
the dialer hand-off will plug in: an incoming bridged call from the agent will
populate lead context and auto-start the timer.

## Project structure (built for expansion)

```
src/
  app/
    layout.tsx            wraps everything in <AppProviders>
    page.tsx              the single-page console
  components/
    app-providers.tsx     tracker context + global end-call dialog
    tracker-provider.tsx  shared timer state + global keyboard
    bucket-grid.tsx       the six compact state toggles
    disposition-dialog.tsx
    stat-cards.tsx        aggregate tiles
    history-table.tsx     saved-call table
    sync-panel.tsx        Google Sheets sync controls
    ui/                   shadcn components (button, card, dialog, table, …)
  hooks/
    useCallTracker.ts     timer state machine (switch/bank/commit) + persistence
  lib/
    types.ts              Bucket / Call / CurrentCall / Disposition types
    config.ts             BUCKETS + DISPOSITIONS (edit here to add states)
    storage.ts            localStorage layer — swap for an API/DB later
    format.ts / stats.ts / csv.ts / sheets.ts   formatting, aggregates, export, sync
```

To add/rename a tracked state or disposition: edit `lib/config.ts` only.

### Natural next expansions
- **Accounts + multi-device:** replace `lib/storage.ts` with Next.js API routes +
  a database (the rest of the app is storage-agnostic).
- **Server-side Sheets/analytics:** move `lib/sheets.ts` behind an API route.
- **Add/rename states or dispositions:** edit `lib/config.ts` only.
- **Per-campaign / per-list tagging, charts, goals:** the `Call` records already
  carry everything needed.

The original single-file prototype is preserved in `legacy/standalone.html`.

## License

MIT — see the repository-root [`LICENSE`](../LICENSE).
