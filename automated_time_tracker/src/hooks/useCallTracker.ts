"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ActiveId, BucketId, Call, CurrentCall } from "@/lib/types";
import { BUCKET_IDS, emptyAcc } from "@/lib/config";
import {
  loadCalls,
  loadCurrent,
  saveCalls,
  saveCurrent,
} from "@/lib/storage";

function freshCall(): CurrentCall {
  const t = Date.now();
  return { startedAt: t, acc: emptyAcc(), active: "idle", activeSince: t };
}

/** Bank the currently-running bucket into acc, given "now". */
function bank(prev: CurrentCall, now: number): Record<BucketId, number> {
  const acc = { ...prev.acc };
  if (prev.active !== "idle") {
    acc[prev.active] = (acc[prev.active] || 0) + (now - prev.activeSince);
  }
  return acc;
}

/**
 * The whole call-timer state machine: exactly one bucket accrues at a time,
 * banking happens on every switch, and finished calls go to a persisted history.
 * Timing uses real timestamps (Date.now) so it's accurate regardless of tick.
 */
export function useCallTracker() {
  const [current, setCurrent] = useState<CurrentCall>(freshCall);
  const [calls, setCalls] = useState<Call[]>([]);
  const [now, setNow] = useState<number>(() => Date.now());
  const [hydrated, setHydrated] = useState(false);

  // Latest current, for handlers that must read it without stale closures.
  const currentRef = useRef(current);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  // Hydrate from localStorage after mount. This is the correct place for it —
  // localStorage isn't available during SSR, and doing it in an initializer would
  // cause a hydration mismatch. The set-state-in-effect rule is a false positive
  // for one-shot external-store hydration.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    const c = loadCurrent();
    if (c) setCurrent(c);
    setCalls(loadCalls());
    setNow(Date.now());
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // Persist.
  useEffect(() => {
    if (hydrated) saveCurrent(current);
  }, [current, hydrated]);
  useEffect(() => {
    if (hydrated) saveCalls(calls);
  }, [calls, hydrated]);

  // Live tick only while a bucket is running. rAF (~60fps) so milliseconds are
  // smooth; pauses automatically when idle or the tab is hidden.
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

  const commitCall = useCallback(
    (dispositionId: string | null, note: string): boolean => {
      const prev = currentRef.current;
      const t = Date.now();
      const acc = bank(prev, t);
      const total = BUCKET_IDS.reduce((s, id) => s + (acc[id] || 0), 0);
      if (total < 1000) return false; // nothing meaningful tracked
      const saved: Call = {
        id: "c" + prev.startedAt,
        startedAt: prev.startedAt,
        endedAt: t,
        acc,
        disposition: dispositionId,
        note: note.trim() || null,
      };
      setCalls((p) => [saved, ...p]);
      const fresh = freshCall();
      currentRef.current = fresh;
      setCurrent(fresh);
      return true;
    },
    [],
  );

  const discardCurrent = useCallback(() => {
    const fresh = freshCall();
    currentRef.current = fresh;
    setCurrent(fresh);
  }, []);

  const deleteCall = useCallback((id: string) => {
    setCalls((p) => p.filter((c) => c.id !== id));
  }, []);

  const clearAll = useCallback(() => setCalls([]), []);

  // Live per-bucket + total ms (uses ticked `now` for display).
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
    active: current.active,
    bucketMs,
    totalMs,
    switchTo,
    toggleBucket,
    commitCall,
    discardCurrent,
    deleteCall,
    clearAll,
    setCalls,
  };
}
