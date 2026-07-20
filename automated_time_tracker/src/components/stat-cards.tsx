"use client";

import { memo } from "react";
import type { Call } from "@/lib/types";
import { computeStats } from "@/lib/stats";
import { fmt } from "@/lib/format";

/** Compact aggregate row — the few numbers that actually matter. */
export const StatCards = memo(function StatCards({ calls }: { calls: Call[] }) {
  const s = computeStats(calls);
  const tiles: { v: string | number; l: string; color?: string }[] = [
    { v: s.totalCalls, l: "Total calls" },
    { v: s.todayCalls, l: "Calls today" },
    { v: fmt(s.timeRight), l: "With right person", color: "#4ade80" },
    { v: fmt(s.timeToRight), l: "Avg time-to-right" },
    { v: fmt(s.timeWrong), l: "Lost: wrong person", color: "#f87171" },
    { v: `${s.productivePct}%`, l: "Productive" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {tiles.map((t, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-4">
          <div
            className="font-mono text-2xl font-bold tabular-nums"
            style={t.color ? { color: t.color } : undefined}
          >
            {t.v}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{t.l}</div>
        </div>
      ))}
    </div>
  );
});
