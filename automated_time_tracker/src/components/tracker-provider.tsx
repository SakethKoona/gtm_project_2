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

/**
 * App-wide tracker context. Holds the one call-timer instance so the running
 * clock survives navigation and shows in the sidebar, and wires global keyboard
 * shortcuts (number keys switch buckets from anywhere). The end-call dialog is
 * controlled here too so it can be triggered app-wide.
 */
type TrackerCtx = ReturnType<typeof useCallTracker> & {
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

export function TrackerProvider({ children }: { children: React.ReactNode }) {
  const t = useCallTracker();
  const [endCallOpen, setEndCallOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const totalRef = useRef(0);
  useEffect(() => {
    totalRef.current = t.totalMs;
  }, [t.totalMs]);

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
      if (endCallOpen) return; // dialog owns keys while open
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
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
    <Ctx.Provider value={{ ...t, endCallOpen, setEndCallOpen, openEndCall, hint }}>
      {children}
    </Ctx.Provider>
  );
}
