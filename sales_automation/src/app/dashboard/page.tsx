"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

type Campaign = { id: string; name: string; overdialRatio: string };
type Rep = {
  id: string;
  name: string;
  phone: string;
  presence: "available" | "away";
  onCall: boolean;
};
type Metrics = {
  dials: number;
  dialsPerMin: number;
  humanReachRate: number;
  repAnswerRate: number;
  avgTimeToHumanMs: number;
  avgHoldMs: number;
  abandonmentRate30d: number;
};
type CallRow = {
  id: string;
  phone: string;
  finalState: string | null;
  disposition: string | null;
  timeToHumanMs: number | null;
  timeline: { state: string; at: string }[] | null;
  startedAt: string;
};
type Snapshot = {
  campaign: Campaign;
  reps: Rep[];
  freeReps: number;
  queueDepth: number;
  metrics: Metrics;
  abandonment: { rate: number; reachedHuman: number; abandoned: number };
  calls: CallRow[];
};
type LiveEvent =
  | { type: "screen_pop"; callId: string; lead: { name: string | null; company: string | null; phone: string; source: string | null; notes: string | null }; at: string }
  | { type: "call_state"; callId: string; state: string; at: string }
  | { type: "governor"; freeReps: number; overdialRatio: number; activeDials: number; cap: number; at: string };

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

export default function Dashboard() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [feed, setFeed] = useState<LiveEvent[]>([]);
  const [gov, setGov] = useState<Extract<LiveEvent, { type: "governor" }> | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const loadCampaigns = useCallback(async () => {
    const r = await fetch("/api/campaigns").then((x) => x.json());
    setCampaigns(r.campaigns);
    if (!selected && r.campaigns[0]) setSelected(r.campaigns[0].id);
  }, [selected]);

  const loadSnap = useCallback(async () => {
    if (!selected) return;
    const r = await fetch(`/api/campaigns/${selected}`).then((x) => x.json());
    if (!r.error) setSnap(r);
  }, [selected]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCampaigns();
  }, [loadCampaigns]);

  useEffect(() => {
    if (!selected) return;
    // loadSnap sets state only after an await (network fetch), not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSnap();
    const poll = setInterval(loadSnap, 2000);

    esRef.current?.close();
    const es = new EventSource(`/api/campaigns/${selected}/events`);
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as LiveEvent;
      if (e.type === "governor") setGov(e);
      else setFeed((f) => [e, ...f].slice(0, 40));
    };
    esRef.current = es;
    return () => {
      clearInterval(poll);
      es.close();
    };
  }, [selected, loadSnap]);

  async function createCampaign() {
    const name = prompt("Campaign name?", "Outbound Q3");
    if (!name) return;
    const r = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).then((x) => x.json());
    await loadCampaigns();
    setSelected(r.campaign.id);
  }

  async function assignLeads() {
    if (!selected) return;
    const r = await fetch(`/api/campaigns/${selected}/assign-leads`, {
      method: "POST",
    }).then((x) => x.json());
    alert(`Assigned ${r.assigned} eligible leads.`);
    loadSnap();
  }

  async function addRep() {
    if (!selected) return;
    const name = prompt("Rep name?", "Rep " + Math.floor(Math.random() * 100));
    if (!name) return;
    const phone = prompt("Rep phone (E.164)?", "+15551230000");
    if (!phone) return;
    await fetch(`/api/campaigns/${selected}/reps`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone }),
    });
    loadSnap();
  }

  async function togglePresence(rep: Rep) {
    if (!selected) return;
    await fetch(`/api/campaigns/${selected}/reps`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repId: rep.id,
        presence: rep.presence === "available" ? "away" : "available",
      }),
    });
    loadSnap();
  }

  async function runBatch() {
    if (!selected) return;
    setFeed([]);
    await fetch(`/api/campaigns/${selected}/simulate`, { method: "POST" });
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div
        className="rise flex flex-wrap items-center justify-between gap-3"
        style={{ "--rise-delay": "80ms" } as React.CSSProperties}
      >
        <div>
          <p className="eyebrow">Admin</p>
          <h1 className="font-display text-2xl">Dialer Dashboard</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select
            value={selected ?? ""}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded-md border border-input bg-card px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {campaigns.length === 0 && <option value="">No campaigns</option>}
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Button variant="outline" onClick={createCampaign}>
            + Campaign
          </Button>
          <Button variant="outline" onClick={assignLeads}>
            Assign eligible leads
          </Button>
          <Button variant="outline" onClick={addRep}>
            + Rep
          </Button>
          <Button onClick={runBatch}>▶ Run simulated batch</Button>
        </div>
      </div>

      {!snap && (
        <p className="mt-8 text-sm text-muted-foreground">
          Create a campaign, assign eligible leads (upload some on the{" "}
          <Link className="text-accent underline" href="/">
            ingestion page
          </Link>{" "}
          first), add a rep or two, then run a simulated batch.
        </p>
      )}

      {snap && (
        <>
          <section
            className="rise mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7"
            style={{ "--rise-delay": "160ms" } as React.CSSProperties}
          >
            <Tile label="Queue depth" value={snap.queueDepth} />
            <Tile label="Free reps" value={gov?.freeReps ?? snap.freeReps} />
            <Tile label="Active dials" value={gov?.activeDials ?? 0} />
            <Tile
              label="Overdial ratio"
              value={(gov?.overdialRatio ?? parseFloat(snap.campaign.overdialRatio)).toFixed(2)}
            />
            <Tile label="Dials (60m)" value={snap.metrics.dials} />
            <Tile label="Human reach" value={pct(snap.metrics.humanReachRate)} />
            <Tile
              label="Abandon 30d"
              value={pct(snap.abandonment.rate)}
              danger={snap.abandonment.rate >= 0.03}
            />
          </section>

          <section
            className="rise mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3"
            style={{ "--rise-delay": "240ms" } as React.CSSProperties}
          >
            <div className="lg:col-span-1">
              <H>Reps</H>
              <div className="space-y-2">
                {snap.reps.length === 0 && (
                  <p className="text-sm text-muted-foreground">No reps yet.</p>
                )}
                {snap.reps.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm"
                  >
                    <div>
                      <div className="font-medium">{r.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{r.phone}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {r.onCall && (
                        <span className="rounded-md bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">
                          on call
                        </span>
                      )}
                      <button
                        onClick={() => togglePresence(r)}
                        className={`rounded-md px-2 py-0.5 text-xs font-medium outline-none transition-[transform,color,background-color] duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 active:scale-[0.98] ${
                          r.presence === "available"
                            ? "bg-green-100 text-green-700"
                            : "bg-secondary text-muted-foreground"
                        }`}
                      >
                        {r.presence}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-2">
              <H>Live feed (screen-pops &amp; call states)</H>
              <div className="h-64 overflow-y-auto rounded-md border border-border bg-card p-2 font-mono text-sm">
                {feed.length === 0 && (
                  <p className="text-muted-foreground">
                    Run a batch to see live hand-offs.
                  </p>
                )}
                {feed.map((e, i) =>
                  e.type === "screen_pop" ? (
                    <div
                      key={i}
                      className="mb-1 rounded-md border border-green-200 bg-green-100 px-3 py-2 text-green-700"
                    >
                      <span className="font-semibold">📞 Screen-pop:</span>{" "}
                      {e.lead.name ?? "Unknown"} — {e.lead.company ?? "?"} (
                      {e.lead.phone})
                      {e.lead.notes && (
                        <span className="text-green-700/70"> · {e.lead.notes}</span>
                      )}
                    </div>
                  ) : e.type === "call_state" ? (
                    <div key={i} className="px-2 py-0.5 text-xs text-muted-foreground">
                      {new Date(e.at).toLocaleTimeString()} · call{" "}
                      {e.callId.slice(0, 8)} → <b className="text-foreground">{e.state}</b>
                    </div>
                  ) : null,
                )}
              </div>
            </div>
          </section>

          <section
            className="rise mt-4"
            style={{ "--rise-delay": "240ms" } as React.CSSProperties}
          >
            <H>Recent calls</H>
            <div className="overflow-x-auto rounded-md border border-border bg-card">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Phone</th>
                    <th className="px-3 py-2 font-medium">Final</th>
                    <th className="px-3 py-2 font-medium">Disposition</th>
                    <th className="px-3 py-2 font-medium">Time→human</th>
                    <th className="px-3 py-2 font-medium">Timeline</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.calls.map((c) => (
                    <tr
                      key={c.id}
                      className="border-t border-border/60 hover:bg-muted/50"
                    >
                      <td className="px-3 py-2 font-mono text-xs tabular-nums">{c.phone}</td>
                      <td className="px-3 py-2">{c.finalState}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {c.disposition}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs tabular-nums">
                        {c.timeToHumanMs != null ? `${c.timeToHumanMs}ms` : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {(c.timeline ?? []).map((t) => t.state).join(" → ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function Tile({
  label,
  value,
  danger,
}: {
  label: string;
  value: string | number;
  danger?: boolean;
}) {
  return (
    <div
      className={`rounded-xl p-3 ${
        danger
          ? "border border-red-200 bg-red-100 text-red-700"
          : "bg-card ring-1 ring-foreground/10"
      }`}
    >
      <div className="font-display text-lg">{value}</div>
      <div
        className={`font-mono text-[0.6rem] uppercase tracking-wider ${
          danger ? "text-red-700/80" : "text-muted-foreground"
        }`}
      >
        {label}
      </div>
    </div>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 mt-2 font-display text-sm text-foreground">{children}</h2>;
}
