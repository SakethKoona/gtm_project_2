"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Trash2, DownloadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Campaign = { id: string; name: string };
type Sheet = {
  id: string;
  name: string | null;
  url: string;
  tab: string | null;
  campaignId: string | null;
  enabled: boolean;
};

const SELECT_CLASS =
  "rounded-md border border-input bg-card px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Central Google Sheets manager (multiple sheets). Each linked sheet is imported
 * by the always-on ingest worker into its campaign; new rows (Result="none") are
 * validated in B2B mode, dialed, and their Result + Notes written back.
 */
export function SheetImportPanel() {
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [svcEmail, setSvcEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Add-form state
  const [url, setUrl] = useState("");
  const [tab, setTab] = useState("");
  const [name, setName] = useState("");
  const [campaignId, setCampaignId] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      const [s, c] = await Promise.all([
        fetch("/api/lead-sheets").then((r) => r.json()),
        fetch("/api/campaigns").then((r) => r.json()),
      ]);
      if (!active) return;
      setSheets(s.sheets ?? []);
      if (s.serviceAccountEmail) setSvcEmail(s.serviceAccountEmail);
      setCampaigns(c.campaigns ?? []);
    })().catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const act = useCallback(
    async (body: Record<string, unknown>, key: string) => {
      setBusy(key);
      setMsg(null);
      try {
        const r = await fetch("/api/lead-sheets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await r.json();
        if (!r.ok) {
          setMsg({ kind: "err", text: data.error ?? "Failed" });
          if (data.serviceAccountEmail) setSvcEmail(data.serviceAccountEmail);
          return null;
        }
        if (data.sheets) setSheets(data.sheets);
        return data;
      } catch (e) {
        setMsg({ kind: "err", text: (e as Error).message });
        return null;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const addSheet = async () => {
    if (!url.trim()) return;
    const data = await act(
      { action: "add", url: url.trim(), tab: tab.trim() || undefined, name: name.trim() || undefined, campaignId: campaignId || undefined },
      "add",
    );
    if (data) {
      setUrl("");
      setTab("");
      setName("");
      setCampaignId("");
      setMsg({ kind: "ok", text: "Sheet added — the ingest worker will pick it up." });
    }
  };

  const importNow = async (id: string) => {
    const data = await act({ action: "import", id }, `import:${id}`);
    if (data?.result) {
      setMsg({ kind: "ok", text: `Imported ${data.result.imported} lead(s).` });
    }
  };

  const test = async () => {
    if (!url.trim()) return;
    setBusy("test");
    setMsg(null);
    try {
      const r = await fetch("/api/sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ping", sheetUrl: url.trim() }),
      });
      const data = await r.json();
      if (data.serviceAccountEmail) setSvcEmail(data.serviceAccountEmail);
      setMsg(
        !r.ok || data.error
          ? { kind: "err", text: data.error ?? "Couldn't reach that sheet." }
          : { kind: "ok", text: "Sheet reachable ✓ (needs Editor access for write-back)." },
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-base font-semibold">Central Google Sheets</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Link one or more sheets (columns <b>Name · Company · Phone · Result · Notes</b>).
        New rows with Result <code>none</code> are imported into the sheet&apos;s campaign,
        dialed, and the outcome written back. Importing runs automatically — toggle the
        Ingestion worker in the <b>Services</b> widget.
      </p>
      {svcEmail && (
        <p className="mt-2 text-xs text-muted-foreground">
          Share each sheet (Editor) with <code>{svcEmail}</code>.
        </p>
      )}

      {/* Linked sheets */}
      <div className="mt-4 space-y-2">
        {sheets.length === 0 && (
          <p className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
            No sheets linked yet — add one below.
          </p>
        )}
        {sheets.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-2">
            <button
              type="button"
              onClick={() => act({ action: "update", id: s.id, enabled: !s.enabled }, `en:${s.id}`)}
              className={cn(
                "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                s.enabled ? "bg-emerald-500" : "bg-muted-foreground/30",
              )}
              title={s.enabled ? "Enabled — click to pause this sheet" : "Paused"}
            >
              <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", s.enabled ? "left-[18px]" : "left-0.5")} />
            </button>
            <a href={s.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1 text-sm font-medium hover:underline" title={s.url}>
              <span className="truncate">{s.name || s.tab || "Sheet"}</span>
              <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
            </a>
            <select
              className={cn(SELECT_CLASS, "ml-auto")}
              value={s.campaignId ?? ""}
              onChange={(e) => act({ action: "update", id: s.id, campaignId: e.target.value || null }, `c:${s.id}`)}
            >
              <option value="">no campaign</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" disabled={busy !== null} onClick={() => importNow(s.id)}>
              <DownloadCloud className="h-3.5 w-3.5" /> {busy === `import:${s.id}` ? "…" : "Import"}
            </Button>
            <button
              type="button"
              onClick={() => confirm("Remove this sheet? (leads already imported stay)") && act({ action: "delete", id: s.id }, `d:${s.id}`)}
              className="rounded p-1 text-muted-foreground hover:bg-red-100 hover:text-red-600"
              title="Remove sheet"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Add a sheet */}
      <div className="mt-4 rounded-lg border border-border p-3">
        <div className="text-xs font-semibold text-muted-foreground">Add a sheet</div>
        <div className="mt-2 grid gap-2">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" />
          <div className="grid gap-2 sm:grid-cols-3">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Label (optional)" />
            <Input value={tab} onChange={(e) => setTab(e.target.value)} placeholder="Tab (optional)" />
            <select className={cn(SELECT_CLASS, "py-2")} value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              <option value="">— campaign —</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={test} disabled={!url.trim() || busy !== null}>
              {busy === "test" ? "Testing…" : "Test"}
            </Button>
            <Button size="sm" onClick={addSheet} disabled={!url.trim() || busy !== null}>
              {busy === "add" ? "Adding…" : "Add sheet"}
            </Button>
          </div>
        </div>
      </div>

      {msg && (
        <p className={cn("mt-3 text-sm", msg.kind === "ok" ? "text-emerald-700" : "text-red-600")}>{msg.text}</p>
      )}
    </section>
  );
}
