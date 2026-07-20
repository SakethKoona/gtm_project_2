"use client";

import { Pause, PhoneOff, Phone, UserRound } from "lucide-react";
import { useTracker } from "@/components/tracker-provider";
import { RepPicker } from "@/components/rep-picker";
import { BucketGrid } from "@/components/bucket-grid";
import { StatCards } from "@/components/stat-cards";
import { HistoryTable } from "@/components/history-table";
import { Button } from "@/components/ui/button";
import { BUCKETS } from "@/lib/config";
import { fmtMs } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function ConsolePage() {
  const t = useTracker();

  // Identity first: no rep selected → show the picker.
  if (!t.repId) return <RepPicker />;

  const active = BUCKETS.find((b) => b.id === t.active);
  const onCall = t.active !== "idle";

  async function togglePresence() {
    const rep = t.currentRep;
    if (!rep?.campaignId) return;
    await fetch(`/api/campaigns/${rep.campaignId}/reps`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repId: rep.id,
        presence: rep.presence === "available" ? "away" : "available",
      }),
    });
    t.reloadReps();
  }

  const available = t.currentRep?.presence === "available";

  return (
    <div className="mx-auto max-w-5xl px-5 py-5">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-primary/15 text-primary">
            <UserRound className="h-4 w-4" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">{t.currentRep?.name ?? "Rep"}</div>
            <button
              className="text-xs text-muted-foreground hover:underline"
              onClick={() => t.setRepId(null)}
            >
              switch rep
            </button>
          </div>
        </div>
        <Button
          size="sm"
          variant={available ? "secondary" : "outline"}
          onClick={togglePresence}
          className="gap-2"
        >
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              available ? "bg-emerald-500" : "bg-muted-foreground/40",
            )}
          />
          {available ? "Available" : "Away"}
        </Button>
      </header>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* Live call */}
        <section className="rounded-xl border border-border bg-card p-5">
          {/* Incoming / active lead context (screen-pop) */}
          {t.incoming ? (
            <div className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
                <Phone className="h-3.5 w-3.5" /> Connected to lead
              </div>
              <div className="mt-1 font-semibold">
                {t.incoming.name ?? "Unknown"}
                {t.incoming.company && (
                  <span className="text-muted-foreground"> · {t.incoming.company}</span>
                )}
              </div>
              <div className="font-mono text-xs text-muted-foreground">
                {t.incoming.phone}
                {t.incoming.note && <span> · {t.incoming.note}</span>}
              </div>
            </div>
          ) : (
            <div className="mb-4 rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
              {available
                ? "Waiting for a call from the dialer…"
                : "Set yourself Available to receive calls."}
            </div>
          )}

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
          {onCall && (
            <p className="mt-1 text-center text-[11px] text-muted-foreground">
              Ring/wait time is tracked automatically by the dialer — you track the
              conversation.
            </p>
          )}
        </section>

        {/* History + stats */}
        <section className="min-w-0 space-y-4">
          <StatCards calls={t.calls} />
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Your recent calls
          </h2>
          <div className="max-h-[520px] overflow-auto">
            <HistoryTable calls={t.calls} />
          </div>
        </section>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
      {children}
    </kbd>
  );
}
