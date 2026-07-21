"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ActiveId, BucketId, Call, CurrentCall } from "@/lib/types";
import { BUCKET_IDS, emptyAcc } from "@/lib/config";
import { loadCurrent, saveCurrent } from "@/lib/storage";

/** Lead context pinned to the console when a dialer call bridges to this rep. */
export type IncomingCall = {
  callId: string; // call_attempts id to finalize
  leadId: string | null;
  campaignId: string | null;
  phone: string;
  name: string | null;
  company: string | null;
  note: string | null;
};

function freshCall(): CurrentCall {
  const t = Date.now();
  return { startedAt: t, acc: emptyAcc(), active: "idle", activeSince: t };
}

function bank(prev: CurrentCall, now: number): Record<BucketId, number> {
  const acc = { ...prev.acc };
  if (prev.active !== "idle") {
    acc[prev.active] = (acc[prev.active] || 0) + (now - prev.activeSince);
  }
  return acc;
}

/**
 * Call-timer state machine, API-backed. The in-progress call lives in
 * localStorage (survives refresh); finished calls are persisted to the platform
 * DB via /api/console/calls and read back for history. When a dialer call is
 * bridged to this rep, `startIncoming` pins the lead and auto-starts on "right".
 */
export function useCallTracker(repId: string | null) {
  const [current, setCurrent] = useState<CurrentCall>(freshCall);
  const [calls, setCalls] = useState<Call[]>([]);
  const [now, setNow] = useState<number>(() => Date.now());
  const [hydrated, setHydrated] = useState(false);
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);

  const currentRef = useRef(current);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);
  const incomingRef = useRef(incoming);
  useEffect(() => {
    incomingRef.current = incoming;
  }, [incoming]);

  // Hydrate the in-progress call from localStorage after mount.
  useEffect(() => {
    const c = loadCurrent();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (c) setCurrent(c);
    setNow(Date.now());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) saveCurrent(current);
  }, [current, hydrated]);

  // Fetch this rep's call history.
  const refetch = useCallback(async () => {
    if (!repId) {
      setCalls([]);
      return;
    }
    try {
      const r = await fetch(`/api/console/calls?repId=${repId}`).then((x) => x.json());
      setCalls(r.calls ?? []);
    } catch {
      /* keep what we have */
    }
  }, [repId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refetch();
  }, [refetch]);

  // Live tick (~60fps) only while a bucket runs; smooth milliseconds.
  useEffect(() => {
    if (current.active === "idle") return;
    let raf = 0;
    const loop = () => {
      setNow(Date.now());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [current.active]);

  const switchTo = useCallback((id: ActiveId) => {
    setCurrent((prev) => {
      const t = Date.now();
      return { ...prev, acc: bank(prev, t), active: id, activeSince: t };
    });
    setNow(Date.now());
  }, []);

  const toggleBucket = useCallback((id: BucketId) => {
    setCurrent((prev) => {
      const t = Date.now();
      const active = prev.active === id ? "idle" : id;
      return { ...prev, acc: bank(prev, t), active, activeSince: t };
    });
    setNow(Date.now());
  }, []);

  /** A dialer call was bridged to this rep: pin the lead + auto-start on "right". */
  const startIncoming = useCallback((call: IncomingCall) => {
    setIncoming(call);
    const t = Date.now();
    const fresh: CurrentCall = {
      startedAt: t,
      acc: emptyAcc(),
      active: "right",
      activeSince: t,
    };
    currentRef.current = fresh;
    setCurrent(fresh);
    setNow(t);
  }, []);

  const commitCall = useCallback(
    async (dispositionId: string | null, note: string): Promise<boolean> => {
      const prev = currentRef.current;
      const t = Date.now();
      const acc = bank(prev, t);
      const total = BUCKET_IDS.reduce((s, id) => s + (acc[id] || 0), 0);
      if (total < 1000) return false;

      const inc = incomingRef.current;
      // The rep only owns the conversation buckets; ring/wait come from the dialer.
      const repBreakdown = {
        right: acc.right,
        wrong: acc.wrong,
        voicemail: acc.voicemail,
        noanswer: acc.noanswer,
      };
      try {
        await fetch("/api/console/calls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callId: inc?.callId,
            repId,
            leadId: inc?.leadId ?? undefined,
            campaignId: inc?.campaignId ?? undefined,
            phone: inc?.phone,
            repBreakdown,
            disposition: dispositionId,
            note: note.trim() || null,
            startedAt: prev.startedAt,
            endedAt: t,
          }),
        });
      } catch {
        /* best-effort; the timer still resets */
      }

      const fresh = freshCall();
      currentRef.current = fresh;
      setCurrent(fresh);
      setIncoming(null);
      refetch();
      return true;
    },
    [repId, refetch],
  );

  const discardCurrent = useCallback(() => {
    const fresh = freshCall();
    currentRef.current = fresh;
    setCurrent(fresh);
    setIncoming(null);
  }, []);

  /** Delete a single saved call, then re-read history from the API. */
  const deleteCall = useCallback(
    async (id: string) => {
      setCalls((p) => p.filter((c) => c.id !== id));
      try {
        await fetch(`/api/console/calls?id=${id}`, { method: "DELETE" });
      } catch {
        /* optimistic; refetch reconciles */
      }
      refetch();
    },
    [refetch],
  );

  /** Clear this rep's entire saved history. */
  const clearAll = useCallback(async () => {
    if (!repId) return;
    setCalls([]);
    try {
      await fetch(`/api/console/calls?repId=${repId}`, { method: "DELETE" });
    } catch {
      /* optimistic; refetch reconciles */
    }
    refetch();
  }, [repId, refetch]);

  /** Mark the given call ids as synced to the Google Sheet, then refetch. */
  const markSynced = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      setCalls((prev) =>
        prev.map((c) => (ids.includes(c.id) ? { ...c, synced: true } : c)),
      );
      try {
        await fetch("/api/console/calls", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
      } catch {
        /* optimistic; refetch reconciles */
      }
      refetch();
    },
    [refetch],
  );

  const bucketMs = useCallback(
    (id: BucketId): number => {
      let ms = current.acc[id] || 0;
      if (current.active === id) ms += now - current.activeSince;
      return ms;
    },
    [current, now],
  );
  const totalMs = BUCKET_IDS.reduce((s, id) => s + bucketMs(id), 0);

  return {
    hydrated,
    current,
    calls,
    incoming,
    active: current.active,
    bucketMs,
    totalMs,
    switchTo,
    toggleBucket,
    startIncoming,
    commitCall,
    discardCurrent,
    deleteCall,
    clearAll,
    markSynced,
    refetch,
  };
}
