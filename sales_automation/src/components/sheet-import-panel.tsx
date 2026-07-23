"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Summary = {
  rowCount: number;
  eligible: number;
  quarantined: number;
  blocked: number;
  invalid: number;
  duplicates: number;
};
type Campaign = { id: string; name: string };
type Config = {
  sheetUrl: string | null;
  tab: string | null;
  campaignId: string | null;
  pollEnabled: boolean;
  serviceAccountEmail: string | null;
};

const SELECT_CLASS =
  "w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Central Google-Sheet lead source (closed loop). Set the sheet URL + campaign,
 * enable real-time polling, or run a one-off import. New rows (Result="none") are
 * validated in B2B mode, dialed, and their Result + Notes written back.
 */
export function SheetImportPanel() {
  const [sheetUrl, setSheetUrl] = useState("");
  const [tab, setTab] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [pollEnabled, setPollEnabled] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [svcEmail, setSvcEmail] = useState<string | null>(null);

  const [busy, setBusy] = useState<null | "test" | "save" | "import">(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [result, setResult] = useState<{ summary: Summary; imported: number; tab: string } | null>(null);

  useEffect(() => {
    (async () => {
      const [cfgR, campR] = await Promise.all([
        fetch("/api/ingest/sheet").then((r) => r.json() as Promise<Config>),
        fetch("/api/campaigns").then((r) => r.json()),
      ]);
      setSheetUrl(cfgR.sheetUrl ?? "");
      setTab(cfgR.tab ?? "");
      setCampaignId(cfgR.campaignId ?? "");
      setPollEnabled(cfgR.pollEnabled);
      setSvcEmail(cfgR.serviceAccountEmail);
      setCampaigns(campR.campaigns ?? []);
    })().catch(() => {});
  }, []);

  const post = useCallback(
    async (runImport: boolean) => {
      setBusy(runImport ? "import" : "save");
      setError(null);
      setNote(null);
      setResult(null);
      try {
        const r = await fetch("/api/ingest/sheet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sheetUrl,
            tab: tab || undefined,
            campaignId: campaignId || undefined,
            pollEnabled,
            runImport,
          }),
        });
        const data = await r.json();
        if (!r.ok) {
          setError(data.error ?? "Request failed");
          if (data.serviceAccountEmail) setSvcEmail(data.serviceAccountEmail);
          return;
        }
        if (runImport) {
          setResult({ summary: data.summary, imported: data.imported, tab: data.tab });
          setNote(
            data.summary.rowCount === 0
              ? "No new rows to import (all rows already have a Result)."
              : `Imported ${data.imported} lead(s) into the queue.`,
          );
        } else {
          setNote("Saved.");
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [sheetUrl, tab, campaignId, pollEnabled],
  );

  const test = useCallback(async () => {
    setBusy("test");
    setError(null);
    setNote(null);
    try {
      const r = await fetch("/api/sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ping", sheetUrl }),
      });
      const data = await r.json();
      if (data.serviceAccountEmail) setSvcEmail(data.serviceAccountEmail);
      if (!r.ok || data.error) setError(data.error ?? "Couldn't reach that sheet.");
      else setNote("Sheet reachable ✓ (make sure the service account has Editor access).");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [sheetUrl]);

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-base font-semibold">Central Google Sheet</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Columns: <b>Name · Company · Phone · Result · Notes</b>. New rows with
        Result <code>none</code> are imported (B2B), dialed, and the outcome is
        written back to the row.
      </p>
      {svcEmail && (
        <p className="mt-2 text-xs text-muted-foreground">
          Share the sheet (Editor) with <code>{svcEmail}</code>.
        </p>
      )}

      <div className="mt-4 grid gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Sheet link</span>
          <Input
            value={sheetUrl}
            onChange={(e) => setSheetUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/…"
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium">Tab (optional)</span>
            <Input
              value={tab}
              onChange={(e) => setTab(e.target.value)}
              placeholder="defaults to the first tab"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Campaign</span>
            <select
              className={SELECT_CLASS}
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
            >
              <option value="">— pick a campaign —</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={pollEnabled}
            onChange={(e) => setPollEnabled(e.target.checked)}
          />
          <span>
            Real-time: keep importing new rows &amp; dialing automatically
            (background poller)
          </span>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={test} disabled={!sheetUrl || busy !== null}>
          {busy === "test" ? "Testing…" : "Test"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => post(false)} disabled={busy !== null}>
          {busy === "save" ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" onClick={() => post(true)} disabled={!sheetUrl || busy !== null}>
          {busy === "import" ? "Importing…" : "Save & import now"}
        </Button>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {note && !error && <p className="mt-3 text-sm text-emerald-700">{note}</p>}

      {result && (
        <div className="mt-4 grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
          {(
            [
              ["Rows", result.summary.rowCount],
              ["Eligible", result.summary.eligible],
              ["Duplicate", result.summary.duplicates],
              ["Invalid", result.summary.invalid],
              ["Blocked", result.summary.blocked],
              ["Quarantined", result.summary.quarantined],
            ] as const
          ).map(([label, n]) => (
            <div key={label} className="rounded-lg border border-border bg-secondary/40 p-2">
              <div className="text-lg font-semibold">{n}</div>
              <div className="text-xs text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
