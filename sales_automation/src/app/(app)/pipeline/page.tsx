"use client";

import { useCallback, useEffect, useState } from "react";
import { GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";
import { LeadTable } from "@/components/pipeline/lead-table";
import { LeadDetail } from "@/components/pipeline/lead-detail";
import { FollowUpQueue } from "@/components/pipeline/followup-queue";
import { STAGE_META, STAGE_ORDER, stageLabel } from "@/components/pipeline/stage-badge";
import type { LeadsResponse, PipelineLead, PipelineSummary, Stage } from "@/components/pipeline/types";

const LIMIT = 50;
type Tab = "leads" | "followups";

export default function PipelinePage() {
  const [tab, setTab] = useState<Tab>("leads");
  const [leads, setLeads] = useState<PipelineLead[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<PipelineSummary | null>(null);

  const [stageFilter, setStageFilter] = useState<Stage | null>(null);
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [queueKey, setQueueKey] = useState(0);

  const loadLeads = useCallback(async () => {
    const params = new URLSearchParams();
    if (stageFilter) params.set("stage", stageFilter);
    if (q.trim()) params.set("q", q.trim());
    params.set("limit", String(LIMIT));
    params.set("offset", String(offset));
    const r: LeadsResponse = await fetch(`/api/leads?${params.toString()}`).then((x) => x.json());
    if (!("error" in (r as object))) {
      setLeads(r.leads ?? []);
      setTotal(r.total ?? 0);
      setSummary(r.summary ?? null);
    }
  }, [stageFilter, q, offset]);

  useEffect(() => {
    // loadLeads only sets state after an await (network fetch), not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadLeads();
  }, [loadLeads]);

  const refreshAll = useCallback(() => {
    loadLeads();
    setQueueKey((k) => k + 1);
  }, [loadLeads]);

  function openLead(id: string) {
    setSelectedId(id);
    setTab("leads");
  }

  const dueNow = summary?.dueNow ?? 0;

  return (
    <main className="mx-auto max-w-7xl px-5 py-5">
      {/* Header */}
      <header className="rise flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-primary/15 text-primary">
            <GitBranch className="h-4 w-4" />
          </div>
          <div>
            <p className="eyebrow">Pipeline</p>
            <h1 className="font-display text-xl">Lead pipeline</h1>
          </div>
        </div>

        {/* Stage-count chips + Due now badge */}
        <div className="flex flex-wrap items-center gap-1.5">
          {STAGE_ORDER.map((s) => (
            <span
              key={s}
              className={cn(
                "inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium",
                STAGE_META[s].cls,
              )}
              title={stageLabel(s)}
            >
              {stageLabel(s)}
              <span className="opacity-70">{summary?.stages?.[s] ?? 0}</span>
            </span>
          ))}
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium",
              dueNow > 0 ? "bg-red-100 text-red-700" : "bg-secondary text-muted-foreground",
            )}
          >
            Due now
            <span className="font-semibold">{dueNow}</span>
          </span>
        </div>
      </header>

      {/* Tabs */}
      <div className="rise mt-4 flex gap-1.5" style={{ "--rise-delay": "80ms" } as React.CSSProperties}>
        <TabButton active={tab === "leads"} onClick={() => setTab("leads")}>
          Leads
        </TabButton>
        <TabButton active={tab === "followups"} onClick={() => setTab("followups")}>
          Follow-ups
          {dueNow > 0 && (
            <span className="ml-1.5 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
              {dueNow}
            </span>
          )}
        </TabButton>
      </div>

      {tab === "leads" ? (
        <div
          className="rise mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]"
          style={{ "--rise-delay": "160ms" } as React.CSSProperties}
        >
          <div className="min-h-[60vh]">
            <LeadTable
              leads={leads}
              total={total}
              offset={offset}
              onOffset={setOffset}
              q={q}
              onQ={(v) => {
                setQ(v);
                setOffset(0);
              }}
              stageFilter={stageFilter}
              onStageFilter={(s) => {
                setStageFilter(s);
                setOffset(0);
              }}
              summary={summary}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </div>
          <LeadDetail key={selectedId ?? "none"} leadId={selectedId} onChanged={refreshAll} />
        </div>
      ) : (
        <div
          className="rise mt-4 max-w-3xl"
          style={{ "--rise-delay": "160ms" } as React.CSSProperties}
        >
          <FollowUpQueue refreshKey={queueKey} onOpenLead={openLead} onChanged={loadLeads} />
        </div>
      )}
    </main>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-lg px-3 py-1.5 text-sm font-medium outline-none transition-[transform,color,background-color] duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 active:scale-[0.98]",
        active
          ? "bg-accent text-accent-foreground"
          : "bg-secondary text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
