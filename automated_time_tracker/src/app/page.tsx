"use client";

import { useState } from "react";
import { Download, Pause, PhoneOff, Settings2, Trash2 } from "lucide-react";
import { useTracker } from "@/components/tracker-provider";
import { BucketGrid } from "@/components/bucket-grid";
import { SyncPanel } from "@/components/sync-panel";
import { StatCards } from "@/components/stat-cards";
import { HistoryTable } from "@/components/history-table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { BUCKETS } from "@/lib/config";
import { fmtMs } from "@/lib/format";
import { downloadCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";

export default function Page() {
  const t = useTracker();
  const active = BUCKETS.find((b) => b.id === t.active);
  const onCall = t.active !== "idle";

  return (
    <div className="mx-auto max-w-5xl px-5 py-5">
      {/* Header */}
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-primary/15 text-primary">
            <PhoneOff className="h-4 w-4" />
          </div>
          <span className="text-sm font-semibold">Call Console</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                onCall ? "animate-pulse bg-emerald-500" : "bg-muted-foreground/40",
              )}
            />
            {onCall ? "On a call" : "Idle"}
          </span>
          <SyncSettingsDialog />
        </div>
      </header>

      {/* Two-column console: left = live call, right = history */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* Live call */}
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="text-center">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t.hint ?? (active ? active.name : "Idle — press 1–6 to start")}
            </div>
            <div
              className="mt-1 font-mono text-5xl font-bold leading-none tabular-nums"
              style={active ? { color: active.color } : undefined}
            >
              {fmtMs(t.totalMs)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">current call</div>
          </div>

          <div className="mt-5">
            <BucketGrid />
          </div>

          <div className="mt-4 flex items-center gap-2">
            <Button className="flex-1 gap-2" onClick={t.openEndCall}>
              <PhoneOff className="h-4 w-4" /> End call &amp; save
            </Button>
            <Button variant="secondary" className="gap-2" onClick={() => t.switchTo("idle")}>
              <Pause className="h-4 w-4" /> Pause
            </Button>
          </div>

          <p className="mt-3 flex flex-wrap items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
            <Kbd>1</Kbd>–<Kbd>6</Kbd> switch
            <span className="opacity-40">·</span>
            <Kbd>Space</Kbd> pause
            <span className="opacity-40">·</span>
            <Kbd>Enter</Kbd> end call
          </p>
        </section>

        {/* History + stats */}
        <section className="min-w-0 space-y-4">
          <StatCards calls={t.calls} />
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Recent calls
            </h2>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs"
                onClick={() => downloadCsv(t.calls)}
              >
                <Download className="h-3.5 w-3.5" /> CSV
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs text-destructive"
                onClick={() => {
                  if (confirm("Delete ALL saved call history? This cannot be undone."))
                    t.clearAll();
                }}
              >
                <Trash2 className="h-3.5 w-3.5" /> Clear
              </Button>
            </div>
          </div>
          <div className="max-h-[520px] overflow-auto">
            <HistoryTable calls={t.calls} onDelete={t.deleteCall} />
          </div>
        </section>
      </div>
    </div>
  );
}

function SyncSettingsDialog() {
  const t = useTracker();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setOpen(true)}>
        <Settings2 className="h-4 w-4" /> Sheet sync
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Google Sheet sync</DialogTitle>
          <DialogDescription>
            Auto-append every finished call to a Google Sheet. Setup steps are in
            SHEETS_SETUP.md.
          </DialogDescription>
        </DialogHeader>
        <Separator />
        <SyncPanel
          calls={t.calls}
          hydrated={t.hydrated}
          onMarkSynced={(ids) =>
            t.setCalls((prev) =>
              prev.map((c) => (ids.includes(c.id) ? { ...c, synced: true } : c)),
            )
          }
        />
        </DialogContent>
      </Dialog>
    </>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
      {children}
    </kbd>
  );
}
