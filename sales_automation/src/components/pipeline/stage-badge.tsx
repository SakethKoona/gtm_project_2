import { cn } from "@/lib/utils";
import type { Stage } from "./types";

type StageMeta = { label: string; cls: string };

/** Display order for filter chips + stage <select>. */
export const STAGE_ORDER: Stage[] = [
  "new",
  "contacted",
  "follow_up",
  "qualified",
  "won",
  "lost",
  "do_not_contact",
];

export const STAGE_META: Record<Stage, StageMeta> = {
  new: { label: "New", cls: "bg-sky-500/15 text-sky-400" },
  contacted: { label: "Contacted", cls: "bg-blue-500/15 text-blue-400" },
  follow_up: { label: "Follow-up", cls: "bg-amber-500/15 text-amber-400" },
  qualified: { label: "Qualified", cls: "bg-violet-500/15 text-violet-400" },
  won: { label: "Won", cls: "bg-emerald-500/15 text-emerald-400" },
  lost: { label: "Lost", cls: "bg-rose-500/15 text-rose-400" },
  do_not_contact: { label: "Do not contact", cls: "bg-zinc-500/15 text-zinc-400" },
};

export function stageLabel(stage: Stage): string {
  return STAGE_META[stage]?.label ?? stage;
}

export function StageBadge({ stage, className }: { stage: Stage; className?: string }) {
  const meta = STAGE_META[stage] ?? { label: stage, cls: "bg-muted text-muted-foreground" };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-2 py-0.5 text-xs font-medium",
        meta.cls,
        className,
      )}
    >
      {meta.label}
    </span>
  );
}
