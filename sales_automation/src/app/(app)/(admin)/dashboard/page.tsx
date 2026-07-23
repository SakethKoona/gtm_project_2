"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Phone, Users, PhoneCall, Radio, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { ServicesPanel } from "@/components/services-panel";

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
type LeadRow = {
  id: string;
  phone: string | null;
  name: string | null;
  company: string | null;
  timezone: string | null;
  attempted: boolean;
  outcome: string | null;
  reachedHuman: boolean;
  disposition: string | null;
  attemptedAt: string | null;
};
type Snapshot = {
  campaign: Campaign;
  reps: Rep[];
  freeReps: number;
  queueDepth: number;
  calledCount: number;
  remainingCount: number;
  metrics: Metrics;
  abandonment: { rate: number; reachedHuman: number; abandoned: number };
  calls: CallRow[];
  leads: LeadRow[];
};
type LiveEvent =
  | { type: "screen_pop"; callId: string; lead: { name: string | null; company: string | null; phone: string; source: string | null; notes: string | null }; at: string }
  | { type: "call_state"; callId: string; state: string; phone?: string; leadId?: string; at: string }
  | { type: "governor"; freeReps: number; overdialRatio: number; activeDials: number; cap: number; at: string }
  | { type: "batch_started"; queued: number; at: string }
  | { type: "batch_finished"; released: number; blockedByGate: number; reachedHuman: number; bridged: number; at: string };

type DialStatus = "idle" | "running" | "done";
type BatchResult = { released: number; blockedByGate: number; reachedHuman: number; bridged: number };
type TwilioCost = {
  configured: boolean;
  currency?: string;
  balance?: number | null;
  totalSpent?: number;
  voiceSpent?: number;
  voiceCount?: number;
  amdSpent?: number;
  amdCount?: number;
  error?: string;
};

type LiveCall = {
  callId: string;
  phone: string | null;
  name: string | null;
  state: string;
  at: string;
  terminal: boolean;
};

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

// State → friendly label + color. Terminal states end the call's life on the board.
const STATE_META: Record<string, { label: string; cls: string; terminal: boolean }> = {
  DIALING: { label: "Dialing", cls: "bg-blue-100 text-blue-700 border-blue-200", terminal: false },
  RINGING: { label: "Ringing", cls: "bg-blue-100 text-blue-700 border-blue-200", terminal: false },
  IVR_MENU: { label: "IVR menu", cls: "bg-amber-100 text-amber-700 border-amber-200", terminal: false },
  ON_HOLD: { label: "On hold", cls: "bg-amber-100 text-amber-700 border-amber-200", terminal: false },
  HUMAN: { label: "Human — handoff", cls: "bg-emerald-100 text-emerald-700 border-emerald-200", terminal: false },
  BRIDGED: { label: "Connected to rep", cls: "bg-emerald-600 text-white border-emerald-600", terminal: true },
  VOICEMAIL: { label: "Voicemail", cls: "bg-violet-100 text-violet-700 border-violet-200", terminal: true },
  DEAD: { label: "No answer", cls: "bg-slate-100 text-slate-600 border-slate-200", terminal: true },
  ABANDONED: { label: "Abandoned", cls: "bg-red-100 text-red-700 border-red-200", terminal: true },
};
const meta = (s: string) =>
  STATE_META[s] ?? { label: s, cls: "bg-slate-100 text-slate-600 border-slate-200", terminal: false };

export default function Dashboard() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [live, setLive] = useState<Record<string, LiveCall>>({});
  const [gov, setGov] = useState<Extract<LiveEvent, { type: "governor" }> | null>(null);
  const [dialStatus, setDialStatus] = useState<DialStatus>("idle");
  const [lastResult, setLastResult] = useState<BatchResult | null>(null);
  const [cost, setCost] = useState<TwilioCost | null>(null);
  const [, setTick] = useState(0);
  const esRef = useRef<EventSource | null>(null);
  const reapRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // 1s ticker so "elapsed" times on live calls update.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Twilio cost — polled slowly (usage lags; balance is the live signal).
  useEffect(() => {
    const load = () =>
      fetch("/api/telephony/cost")
        .then((x) => x.json())
        .then(setCost)
        .catch(() => {});
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLive({});
    setDialStatus("idle");
    setLastResult(null);
    loadSnap();
    const poll = setInterval(loadSnap, 2000);

    esRef.current?.close();
    const es = new EventSource(`/api/campaigns/${selected}/events`);
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as LiveEvent;
      if (e.type === "batch_started") {
        setDialStatus("running");
        setLastResult(null);
      } else if (e.type === "batch_finished") {
        setDialStatus("done");
        setLastResult({ released: e.released, blockedByGate: e.blockedByGate, reachedHuman: e.reachedHuman, bridged: e.bridged });
        loadSnap();
      } else if (e.type === "governor") {
        setGov(e);
      } else if (e.type === "call_state") {
        const m2 = meta(e.state);
        setLive((prev) => ({
          ...prev,
          [e.callId]: {
            callId: e.callId,
            phone: e.phone ?? prev[e.callId]?.phone ?? null,
            name: prev[e.callId]?.name ?? null,
            state: e.state,
            at: e.at,
            terminal: m2.terminal,
          },
        }));
        // When a call finishes, keep it visible briefly, then drop it + refresh.
        if (m2.terminal) {
          clearTimeout(reapRef.current[e.callId]);
          reapRef.current[e.callId] = setTimeout(() => {
            setLive((prev) => {
              const next = { ...prev };
              delete next[e.callId];
              return next;
            });
            loadSnap();
          }, 12000);
        }
      } else if (e.type === "screen_pop") {
        setLive((prev) => ({
          ...prev,
          [e.callId]: {
            callId: e.callId,
            phone: e.lead.phone ?? prev[e.callId]?.phone ?? null,
            name: e.lead.name ?? prev[e.callId]?.name ?? null,
            state: prev[e.callId]?.state ?? "HUMAN",
            at: e.at,
            terminal: false,
          },
        }));
      }
    };
    esRef.current = es;
    const reap = reapRef.current;
    return () => {
      clearInterval(poll);
      es.close();
      Object.values(reap).forEach(clearTimeout);
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
    const r = await fetch(`/api/campaigns/${selected}/assign-leads`, { method: "POST" }).then((x) => x.json());
    alert(`Assigned ${r.assigned} eligible leads.`);
    loadSnap();
  }

  async function addRep() {
    if (!selected) return;
    const name = prompt("Rep name?", "Rep " + Math.floor(Math.random() * 100));
    if (!name) return;
    const phone = prompt("Rep phone (E.164)?", "+1");
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
      body: JSON.stringify({ repId: rep.id, presence: rep.presence === "available" ? "away" : "available" }),
    });
    loadSnap();
  }

  async function startRealDialing() {
    if (!selected) return;
    if (!confirm("Place REAL phone calls for this campaign? This dials live leads through Twilio.")) return;
    setLive({});
    const r = await fetch(`/api/campaigns/${selected}/dial`, { method: "POST" })
      .then((x) => x.json())
      .catch(() => ({ error: "request failed" }));
    if (r.error) {
      alert(`Could not start dialing: ${r.error}`);
    } else {
      setDialStatus("running");
      setLastResult(null);
    }
  }

  const liveCalls = Object.values(live).sort((a, b) => b.at.localeCompare(a.at));
  const activeCount = liveCalls.filter((c) => !c.terminal).length;
  // phone → current live state, so a lead can show "Ringing" while it's dialed.
  const liveByPhone = new Map<string, string>();
  for (const c of liveCalls) if (!c.terminal && c.phone) liveByPhone.set(c.phone, c.state);
  // Running, but nothing in flight and no rep free → the engine is parked waiting.
  const waiting =
    dialStatus === "running" &&
    activeCount === 0 &&
    (gov?.cap ?? 0) === 0 &&
    (snap?.queueDepth ?? 0) > 0;

  return (
    <main className="mx-auto max-w-6xl px-5 py-6">
      {/* Header + controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-primary/15 text-primary">
            <PhoneCall className="h-4 w-4" />
          </div>
          <h1 className="text-lg font-semibold">Dialer Dashboard</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select
            value={selected ?? ""}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-foreground"
          >
            {campaigns.length === 0 && <option value="">No campaigns</option>}
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <Btn onClick={createCampaign}>+ Campaign</Btn>
          <Btn onClick={assignLeads}>Assign leads</Btn>
          <Btn onClick={addRep}>+ Rep</Btn>
          <Btn onClick={startRealDialing} primary>📞 Start real dialing</Btn>
        </div>
      </div>

      <ServicesPanel />

      {!snap && (
        <p className="mt-8 text-sm text-muted-foreground">
          Create a campaign, assign eligible leads (upload some on the{" "}
          <Link className="underline" href="/">ingestion page</Link> first), add a rep, then start dialing.
        </p>
      )}

      {snap && (
        <>
          {/* Dialer status banner */}
          <StatusBanner
            status={dialStatus}
            waiting={waiting}
            activeCount={activeCount}
            activeCalls={liveCalls.filter((c) => !c.terminal)}
            result={lastResult}
          />

          {/* Metric tiles */}
          <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Tile label="Leads in queue" value={snap.queueDepth} />
            <Tile label="Active calls" value={activeCount} accent />
            <Tile label="Free reps" value={gov?.freeReps ?? snap.freeReps} />
            <Tile label="Overdial ratio" value={(gov?.overdialRatio ?? parseFloat(snap.campaign.overdialRatio)).toFixed(2)} />
            <Tile label="Human reach" value={pct(snap.metrics.humanReachRate)} />
            <Tile label="Abandon 30d" value={pct(snap.abandonment.rate)} danger={snap.abandonment.rate >= 0.03} />
          </section>

          {/* Twilio cost */}
          <CostBar cost={cost} />

          <section className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* LIVE CALLS */}
            <div>
              <SectionHead icon={Radio}>
                Live calls
                <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                  {activeCount} active
                </span>
              </SectionHead>
              <div className="space-y-2">
                {liveCalls.length === 0 && (
                  <Empty>No calls in flight. Start dialing to see live calls appear here with their status.</Empty>
                )}
                {liveCalls.map((c) => {
                  const m = meta(c.state);
                  return (
                    <div
                      key={c.callId}
                      className={cn(
                        "flex items-center justify-between rounded-lg border bg-card px-3 py-2.5 transition-opacity",
                        c.terminal ? "border-border opacity-60" : "border-border",
                      )}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 font-mono text-sm font-medium">
                          {!c.terminal && (
                            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-500" />
                          )}
                          {c.phone ?? `call ${c.callId.slice(0, 8)}`}
                        </div>
                        {c.name && <div className="truncate text-xs text-muted-foreground">{c.name}</div>}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {!c.terminal && (
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            {elapsed(c.at)}
                          </span>
                        )}
                        <span className={cn("rounded-full border px-2.5 py-1 text-xs font-medium", m.cls)}>
                          {m.label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* LEADS QUEUE */}
            <div>
              <SectionHead icon={Phone}>
                Leads
                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {snap.remainingCount} left · {snap.calledCount} called · {snap.leads.length} total
                </span>
              </SectionHead>
              <div className="max-h-[420px] space-y-1.5 overflow-auto">
                {snap.leads.length === 0 && (
                  <Empty>No leads assigned. Upload on the ingestion page, then “Assign leads.”</Empty>
                )}
                {snap.leads.map((l) => {
                  // Priority: live (being dialed now) → outcome (already called) → queued.
                  const liveState = l.phone ? liveByPhone.get(l.phone) : undefined;
                  const badge = liveState
                    ? { label: meta(liveState).label, cls: meta(liveState).cls, pulse: true }
                    : l.attempted
                      ? l.outcome
                        ? { label: meta(l.outcome).label, cls: meta(l.outcome).cls, pulse: false }
                        : { label: "called", cls: "bg-slate-100 text-slate-600 border-slate-200", pulse: false }
                      : { label: "queued", cls: "bg-slate-100 text-slate-500 border-slate-200", pulse: false };
                  return (
                    <div
                      key={l.id}
                      className={cn(
                        "flex items-center justify-between rounded-lg border bg-card px-3 py-2 text-sm",
                        liveState ? "border-emerald-300" : "border-border",
                      )}
                    >
                      <div className="min-w-0">
                        <div className="font-mono text-sm">{l.phone ?? "—"}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {l.name ?? "Unknown"}{l.company ? ` · ${l.company}` : ""}
                          {l.disposition ? ` · ${l.disposition}` : ""}
                        </div>
                      </div>
                      <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium", badge.cls, badge.pulse && "animate-pulse")}>
                        {badge.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Reps */}
          <section className="mt-5">
            <SectionHead icon={Users}>Reps</SectionHead>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {snap.reps.length === 0 && <Empty>No reps yet — add one to receive bridged calls.</Empty>}
              {snap.reps.map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-sm">
                  <div>
                    <div className="font-medium">{r.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">{r.phone}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.onCall && (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">on call</span>
                    )}
                    <button
                      onClick={() => togglePresence(r)}
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-xs font-medium",
                        r.presence === "available" ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {r.presence}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Recent completed calls */}
          <section className="mt-5">
            <SectionHead icon={PhoneCall}>Recent calls</SectionHead>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Phone</th>
                    <th className="px-3 py-2">Outcome</th>
                    <th className="px-3 py-2">Disposition</th>
                    <th className="px-3 py-2">Time→human</th>
                    <th className="px-3 py-2">Timeline</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.calls.length === 0 && (
                    <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No completed calls yet.</td></tr>
                  )}
                  {snap.calls.map((c) => (
                    <tr key={c.id} className="border-t border-border">
                      <td className="px-3 py-2 font-mono text-xs">{c.phone}</td>
                      <td className="px-3 py-2">
                        <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", meta(c.finalState ?? "").cls)}>
                          {meta(c.finalState ?? "—").label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{c.disposition ?? "—"}</td>
                      <td className="px-3 py-2 text-xs">{c.timeToHumanMs != null ? `${c.timeToHumanMs}ms` : "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{(c.timeline ?? []).map((t) => t.state).join(" → ")}</td>
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

function CostBar({ cost }: { cost: TwilioCost | null }) {
  if (!cost) return null;
  if (!cost.configured) {
    return (
      <div className="mt-3 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground">
        Twilio cost unavailable — telephony not configured.
      </div>
    );
  }
  const cur = cost.currency ?? "USD";
  const money = (n: number | null | undefined) =>
    n == null ? "—" : `$${n.toFixed(2)}`;
  const money4 = (n: number | null | undefined) =>
    n == null ? "—" : `$${n.toFixed(4)}`;

  return (
    <section className="mt-3">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <DollarSign className="h-4 w-4 text-muted-foreground" />
        Twilio cost
        <span className="text-xs font-normal text-muted-foreground">({cur} · usage lags a few min, balance is live)</span>
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <div className="text-xl font-semibold tabular-nums text-emerald-700">{money(cost.balance)}</div>
          <div className="text-xs text-emerald-700/80">Balance remaining</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-xl font-semibold tabular-nums">{money4(cost.totalSpent)}</div>
          <div className="text-xs text-muted-foreground">Total spent (all-time)</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-xl font-semibold tabular-nums">{money4(cost.voiceSpent)}</div>
          <div className="text-xs text-muted-foreground">Voice · {cost.voiceCount ?? 0} calls</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-xl font-semibold tabular-nums">{money4(cost.amdSpent)}</div>
          <div className="text-xs text-muted-foreground">AMD · {cost.amdCount ?? 0} checks</div>
        </div>
      </div>
    </section>
  );
}

function elapsed(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

function StatusBanner({
  status,
  waiting,
  activeCount,
  activeCalls,
  result,
}: {
  status: DialStatus;
  waiting: boolean;
  activeCount: number;
  activeCalls: LiveCall[];
  result: BatchResult | null;
}) {
  let dot = "bg-muted-foreground/40";
  let text = "Idle — not dialing. Press “Start real dialing” to begin.";
  let pulse = false;
  let tone = "border-border bg-card text-muted-foreground";

  if (status === "running") {
    if (waiting) {
      dot = "bg-amber-500";
      pulse = true;
      text = "Waiting — no rep available. Set a rep to “available” to release calls.";
      tone = "border-amber-200 bg-amber-50 text-amber-800";
    } else if (activeCount > 0) {
      dot = "bg-emerald-500";
      pulse = true;
      const nums = activeCalls
        .map((c) => `${c.phone ?? "?"} (${meta(c.state).label})`)
        .join(", ");
      text = `Dialing ${activeCount} — ${nums}`;
      tone = "border-emerald-200 bg-emerald-50 text-emerald-800";
    } else {
      dot = "bg-blue-500";
      pulse = true;
      text = "Dialing — placing calls…";
      tone = "border-blue-200 bg-blue-50 text-blue-800";
    }
  } else if (status === "done") {
    dot = "bg-emerald-600";
    text = result
      ? `Batch complete — ${result.released} dialed · ${result.reachedHuman} reached a human · ${result.bridged} bridged · ${result.blockedByGate} blocked by compliance.`
      : "Batch complete.";
    tone = "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  return (
    <div className={cn("mt-4 flex items-center gap-2.5 rounded-lg border px-4 py-2.5 text-sm font-medium", tone)}>
      <span className={cn("h-2.5 w-2.5 rounded-full", dot, pulse && "animate-pulse")} />
      {text}
    </div>
  );
}

function Btn({ children, onClick, primary }: { children: React.ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        primary ? "bg-primary text-primary-foreground hover:opacity-90" : "border border-border text-foreground hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

function Tile({ label, value, danger, accent }: { label: string; value: string | number; danger?: boolean; accent?: boolean }) {
  return (
    <div className={cn("rounded-lg border p-3", danger ? "border-red-200 bg-red-50" : "border-border bg-card")}>
      <div className={cn("text-xl font-semibold tabular-nums", danger ? "text-red-700" : accent ? "text-primary" : "")}>
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function SectionHead({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
      <Icon className="h-4 w-4 text-muted-foreground" />
      {children}
    </h2>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
