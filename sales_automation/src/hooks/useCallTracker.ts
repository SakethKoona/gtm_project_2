"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ActiveId, BucketId, Call, CurrentCall } from "@/lib/types";
import { BUCKET_IDS, emptyAcc } from "@/lib/config";
import {
  loadCurrent,
  saveCurrent,
  loadCalls,
  saveCalls,
} from "@/lib/storage";

/**
 * Sentinel rep id for "solo" mode: use the console standalone, with no rep and
 * no database — finished calls persist to localStorage, exactly like the
 * original standalone tracker. Any other (real) rep id routes calls to the DB.
 */
export const SOLO_REP_ID = "solo";

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
  return { startedAt: t, firstActiveAt: null, acc: emptyAcc(), active: "idle", activeSince: t };
}

function bank(prev: CurrentCall, now: number): Record<BucketId, number> {
  const acc = { ...prev.acc };
  if (prev.active !== "idle") {
    acc[prev.active] = (acc[prev.active] || 0) + (now - prev.activeSince);
  }
  return acc;
}

/** Stamp the call's real start the first time any bucket is activated. */
function markStart(prev: CurrentCall, activating: ActiveId, t: number): number | null {
  if (prev.firstActiveAt != null) return prev.firstActiveAt;
  return activating !== "idle" ? t : null;
}

/**
 * Call-timer state machine, API-backed. The in-progress call lives in
 * localStorage (survives refresh); finished calls are persisted to the platform
 * DB via /api/console/calls and read back for history. When a dialer call is
 * bridged to this rep, `startIncoming` pins the lead and auto-starts on "right".
 */
export function useCallTracker(repId: string | null) {
  const solo = repId === SOLO_REP_ID;
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

  // Fetch call history. Solo mode reads from localStorage; a real rep reads the DB.
  const refetch = useCallback(async () => {
    if (solo) {
      setCalls(loadCalls());
      return;
    }
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
  }, [repId, solo]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refetch();
  }, [refetch]);

  // Live tick (~60fps) while a bucket runs OR the call is in progress (so the
  // call clock keeps advancing through idle gaps, matching the logged total).
  const inProgress = current.active !== "idle" || current.firstActiveAt != null;
  useEffect(() => {
    if (!inProgress) return;
    let raf = 0;
    const loop = () => {
      setNow(Date.now());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [inProgress]);

  const switchTo = useCallback((id: ActiveId) => {
    setCurrent((prev) => {
      const t = Date.now();
      return {
        ...prev,
        acc: bank(prev, t),
        active: id,
        activeSince: t,
        firstActiveAt: markStart(prev, id, t),
      };
    });
    setNow(Date.now());
  }, []);

  const toggleBucket = useCallback((id: BucketId) => {
    setCurrent((prev) => {
      const t = Date.now();
      const active = prev.active === id ? "idle" : id;
      return {
        ...prev,
        acc: bank(prev, t),
        active,
        activeSince: t,
        firstActiveAt: markStart(prev, active, t),
      };
    });
    setNow(Date.now());
  }, []);

  /** A dialer call was bridged to this rep: pin the lead + auto-start on "right". */
  const startIncoming = useCallback((call: IncomingCall) => {
    setIncoming(call);
    const t = Date.now();
    const fresh: CurrentCall = {
      startedAt: t,
      firstActiveAt: t,
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
      const tracked = BUCKET_IDS.reduce((s, id) => s + (acc[id] || 0), 0);
      // Real call start = first time a bucket was pressed; total = elapsed since.
      const startedAt = prev.firstActiveAt ?? prev.startedAt;
      const elapsed = t - startedAt;
      // Nothing meaningful tracked → don't save.
      if (prev.firstActiveAt == null || (tracked < 1000 && elapsed < 1000)) return false;

      // Solo mode: persist the full six-bucket call to localStorage, no DB.
      if (solo) {
        const call: Call = {
          id:
            typeof crypto !== "undefined" && crypto.randomUUID
              ? crypto.randomUUID()
              : `${t}-${Math.round(elapsed)}`,
          startedAt,
          endedAt: t,
          acc,
          disposition: dispositionId,
          note: note.trim() || null,
          synced: false,
        };
        setCalls((prevCalls) => {
          const next = [call, ...prevCalls];
          saveCalls(next);
          return next;
        });
        const fresh = freshCall();
        currentRef.current = fresh;
        setCurrent(fresh);
        setIncoming(null);
        return true;
      }

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
            startedAt,
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
    [repId, solo, refetch],
  );

  /** Mark calls as synced to the Sheet (persisted in solo mode). */
  const markSynced = useCallback(
    (ids: string[]) => {
      setCalls((prev) => {
        const next = prev.map((c) =>
          ids.includes(c.id) ? { ...c, synced: true } : c,
        );
        if (solo) saveCalls(next);
        return next;
      });
    },
    [solo],
  );

  /** Delete a saved call (solo mode only — DB history is read-only here). */
  const deleteCall = useCallback(
    (id: string) => {
      if (!solo) return;
      setCalls((prev) => {
        const next = prev.filter((c) => c.id !== id);
        saveCalls(next);
        return next;
      });
    },
    [solo],
  );

  /** Clear all saved calls (solo mode only). */
  const clearAll = useCallback(() => {
    if (!solo) return;
    setCalls([]);
    saveCalls([]);
  }, [solo]);

  const discardCurrent = useCallback(() => {
    const fresh = freshCall();
    currentRef.current = fresh;
    setCurrent(fresh);
    setIncoming(null);
  }, []);

  const bucketMs = useCallback(
    (id: BucketId): number => {
      let ms = current.acc[id] || 0;
      if (current.active === id) ms += now - current.activeSince;
      return ms;
    },
    [current, now],
  );
  const totalMs = BUCKET_IDS.reduce((s, id) => s + bucketMs(id), 0);
  // Real elapsed time of the in-progress call (start → now), incl. idle gaps.
  const elapsedMs =
    current.firstActiveAt != null ? Math.max(0, now - current.firstActiveAt) : 0;

  return {
    hydrated,
    current,
    calls,
    incoming,
    active: current.active,
    bucketMs,
    totalMs,
    elapsedMs,
    switchTo,
    toggleBucket,
    startIncoming,
    commitCall,
    discardCurrent,
    refetch,
    markSynced,
    deleteCall,
    clearAll,
    solo,
  };
}
