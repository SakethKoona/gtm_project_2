"use client";

import { useTracker } from "./tracker-provider";
import { BUCKETS } from "@/lib/config";
import { fmtMs } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Six compact state toggles. One active at a time; click or press its number. */
export function BucketGrid() {
  const t = useTracker();
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {BUCKETS.map((b) => {
        const active = t.active === b.id;
        return (
          <button
            key={b.id}
            onClick={() => t.toggleBucket(b.id)}
            title={b.sub}
            style={
              active
                ? {
                    borderColor: `${b.color}55`,
                    background: `${b.color}14`,
                    boxShadow: `inset 0 0 0 1px ${b.color}55`,
                  }
                : undefined
            }
            className={cn(
              "flex flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2.5 text-left outline-none transition-[transform,color,background-color] duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 active:scale-[0.98]",
              !active && "hover:bg-muted",
            )}
          >
            <span className="flex items-center gap-2">
              <kbd
                style={active ? { color: b.color, borderColor: b.color } : undefined}
                className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] leading-none text-muted-foreground"
              >
                {b.key}
              </kbd>
              <span className="text-sm font-semibold text-foreground">{b.short}</span>
              {active && (
                <span
                  className="ml-auto h-1.5 w-1.5 shrink-0 animate-pulse rounded-full"
                  style={{ background: b.color }}
                />
              )}
            </span>
            <span
              style={active ? { color: b.color } : undefined}
              className="font-mono text-sm tabular-nums text-muted-foreground"
            >
              {fmtMs(t.bucketMs(b.id))}
            </span>
          </button>
        );
      })}
    </div>
  );
}
