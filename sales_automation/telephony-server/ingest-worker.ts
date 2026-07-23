import { config } from "dotenv";
// Google Sheets service-account creds live in .env.local (like the Next app);
// DB URL lives in .env. dotenv never overrides already-set vars.
config({ path: ".env.local" });
config();

import { getLeadSheetConfig } from "../src/lib/settings";
import { importSheetLeads } from "../src/lib/ingestion/sheet-source";
import { heartbeat, isServiceEnabled } from "../src/lib/services";

/**
 * Lead-sheet ingestion worker — a standalone always-on service, separate from the
 * dialer.
 *
 *   • This worker CONSTANTLY reads the central Google Sheet and imports new rows
 *     (Result="none" → validated → "Queued", assigned to the campaign). It never
 *     places calls.
 *   • Dialing is a SEPARATE service (the telephony server) and runs only on demand
 *     — hit "Dial" in the dashboard when you want to call the queued leads.
 *
 * So the sheet always stays in sync with the queue, and you dial when you choose.
 * Configure the sheet URL / tab / campaign / enable toggle in the admin panel
 * (stored in app_settings); this worker reads that config every pass.
 *
 * Run: `npm run ingest`
 */

const POLL_MS = Number(process.env.LEAD_SHEET_POLL_MS ?? 25000);

let inFlight = false; // skip overlapping passes if a read runs long
let totalImported = 0;
async function tick(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const enabled = await isServiceEnabled("ingest");
    const cfg = await getLeadSheetConfig();
    // Heartbeat every tick (even when paused/idle) so the Services panel shows the
    // process is alive; `enabled` drives whether we actually import.
    await heartbeat("ingest", {
      enabled,
      configured: !!cfg.sheetUrl,
      totalImported,
    });
    if (!enabled) return; // paused from the Services panel
    if (!cfg.sheetUrl) return; // no sheet configured yet

    const res = await importSheetLeads({
      sheetUrl: cfg.sheetUrl,
      tab: cfg.tab ?? undefined,
      campaignId: cfg.campaignId ?? undefined,
      uploadedBy: "ingest-worker",
    });
    if (res.imported > 0) {
      totalImported += res.imported;
      console.log(
        `[ingest] ${new Date().toISOString()} — imported ${res.imported} new lead(s) from "${res.tab}" ` +
          `(${res.summary.duplicates} dup, ${res.summary.invalid} invalid)`,
      );
      await heartbeat("ingest", {
        enabled,
        configured: true,
        totalImported,
        lastImport: res.imported,
        lastImportAt: new Date().toISOString(),
      });
    }
  } catch (e) {
    console.error("[ingest] pass failed:", (e as Error)?.stack ?? e);
  } finally {
    inFlight = false;
  }
}

console.log(
  `📄 ingestion worker up — reading the lead sheet every ${Math.round(POLL_MS / 1000)}s. ` +
    `Dialing is separate (start the telephony server + hit Dial).`,
);
void tick(); // run once immediately, then on the interval
setInterval(() => void tick(), POLL_MS);

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
