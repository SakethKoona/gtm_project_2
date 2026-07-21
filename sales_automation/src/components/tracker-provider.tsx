"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useCallTracker } from "@/hooks/useCallTracker";
import { BUCKETS } from "@/lib/config";

export type Rep = {
  id: string;
  name: string;
  phone: string;
  presence: "available" | "away";
  onCall: boolean;
  campaignId: string | null;
};

type TrackerCtx = ReturnType<typeof useCallTracker> & {
  reps: Rep[];
  repId: string | null;
  currentRep: Rep | null;
  setRepId: (id: string | null) => void;
  reloadReps: () => void;
  endCallOpen: boolean;
  setEndCallOpen: (v: boolean) => void;
  openEndCall: () => void;
  hint: string | null;
};

const Ctx = createContext<TrackerCtx | null>(null);

export function useTracker(): TrackerCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTracker must be used within TrackerProvider");
  return c;
}

const REP_KEY = "console.repId";

export function TrackerProvider({ children }: { children: React.ReactNode }) {
  const [reps, setReps] = useState<Rep[]>([]);
  const [repId, setRepIdState] = useState<string | null>(null);
  const t = useCallTracker(repId);
  const [endCallOpen, setEndCallOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const currentRep = reps.find((r) => r.id === repId) ?? null;

  const reloadReps = useCallback(async () => {
    try {
      const r = await fetch("/api/reps").then((x) => x.json());
      setReps(r.reps ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRepIdState(localStorage.getItem(REP_KEY));
    reloadReps();
  }, [reloadReps]);

  const setRepId = useCallback((id: string | null) => {
    if (id) localStorage.setItem(REP_KEY, id);
    else localStorage.removeItem(REP_KEY);
    setRepIdState(id);
  }, []);

  // Subscribe to this rep's campaign event stream: auto-start on a bridged call.
  const startIncomingRef = useRef(t.startIncoming);
  useEffect(() => {
    startIncomingRef.current = t.startIncoming;
  }, [t.startIncoming]);

  useEffect(() => {
    const campaignId = currentRep?.campaignId;
    if (!repId || !campaignId) return;
    const es = new EventSource(`/api/campaigns/${campaignId}/events`);
    es.onmessage = (m) => {
      const e = JSON.parse(m.data);
      if (e.type === "call_bridged" && e.repId === repId) {
        startIncomingRef.current({
          callId: e.callId,
          leadId: e.lead?.id ?? null,
          campaignId: e.campaignId ?? null,
          phone: e.lead?.phone ?? "",
          name: e.lead?.name ?? null,
          company: e.lead?.company ?? null,
          note: e.lead?.notes ?? null,
        });
      }
    };
    return () => es.close();
  }, [repId, currentRep?.campaignId]);

  const totalRef = useRef(0);
  useEffect(() => {
    // Guard on the real elapsed call time (falls back to tracked bucket time).
    totalRef.current = Math.max(t.elapsedMs, t.totalMs);
  }, [t.elapsedMs, t.totalMs]);

  const openEndCall = useCallback(() => {
    if (totalRef.current < 1000) {
      setHint("nothing tracked yet");
      setTimeout(() => setHint(null), 1000);
      return;
    }
    t.switchTo("idle");
    setEndCallOpen(true);
  }, [t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (endCallOpen) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.repeat) return;
      const b = BUCKETS.find((x) => x.key === e.key);
      if (b) {
        e.preventDefault();
        t.toggleBucket(b.id);
        return;
      }
      if (e.key === " " || e.key === "0") {
        e.preventDefault();
        t.switchTo("idle");
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        openEndCall();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [endCallOpen, t, openEndCall]);

  return (
    <Ctx.Provider
      value={{
        ...t,
        reps,
        repId,
        currentRep,
        setRepId,
        reloadReps,
        endCallOpen,
        setEndCallOpen,
        openEndCall,
        hint,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
