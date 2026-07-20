import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { callAttempts } from "@/db/schema";
import {
  logOutcome,
  completePendingCallFollowUps,
} from "@/lib/pipeline/service";
import { recordCalled } from "@/lib/pipeline/ledger";
import { OUTCOME_TEMPLATES } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Rep disposition → outcome template (design §6). "other" has no template and
 * becomes a custom note-only outcome (falls through to undefined).
 */
const DISPOSITION_TO_TEMPLATE: Record<string, string> = {
  booked: "meeting",
  callback: "callback",
  not_interested: "not_interested",
  wrong_number: "wrong_number",
  no_contact: "no_answer",
};

type Timeline = { state: string; at: string }[] | null;

/**
 * Derive the dialer's pre-bridge time from its state timeline: RINGING → ringing,
 * IVR_MENU/ON_HOLD → waiting. This is the "combine" — the dialer already tracked
 * ring/wait automatically, so the rep only tracks the conversation.
 */
function preBridge(timeline: Timeline): { ringing: number; waiting: number } {
  const out = { ringing: 0, waiting: 0 };
  if (!timeline) return out;
  for (let i = 0; i < timeline.length - 1; i++) {
    const dur = Date.parse(timeline[i + 1].at) - Date.parse(timeline[i].at);
    if (!(dur > 0)) continue;
    const s = timeline[i].state;
    if (s === "RINGING" || s === "DIALING") out.ringing += dur;
    else if (s === "IVR_MENU" || s === "ON_HOLD") out.waiting += dur;
  }
  return out;
}

/** Merge dialer pre-bridge + rep breakdown into the six-bucket `acc` the UI uses. */
function toAcc(
  timeline: Timeline,
  holdMs: number | null,
  rep: Record<string, number> | null,
) {
  const pre = preBridge(timeline);
  const r = rep ?? {};
  return {
    ringing: pre.ringing,
    waiting: pre.waiting || holdMs || 0,
    right: r.right || 0,
    wrong: r.wrong || 0,
    voicemail: r.voicemail || 0,
    noanswer: r.noanswer || 0,
  };
}

// ── GET: recent calls for a rep (history + stats) ────────────────────────────
export async function GET(request: Request) {
  const repId = new URL(request.url).searchParams.get("repId");
  if (!repId) return Response.json({ calls: [] });

  const rows = await db
    .select()
    .from(callAttempts)
    .where(eq(callAttempts.repId, repId))
    .orderBy(desc(callAttempts.startedAt))
    .limit(100);

  const calls = rows.map((c) => ({
    id: c.id,
    startedAt: c.startedAt.getTime(),
    endedAt: (c.endedAt ?? c.startedAt).getTime(),
    acc: toAcc(c.timeline, c.holdMs, c.repBreakdown),
    disposition: c.disposition,
    note: c.repNote,
    synced: c.syncedToSheet,
  }));
  return Response.json({ calls });
}

// ── POST: finalize a bridged call or log a manual one ────────────────────────
const bodySchema = z.object({
  callId: z.string().optional(), // dialer call_attempts id, if finalizing
  repId: z.string(),
  leadId: z.string().optional(),
  campaignId: z.string().optional(),
  phone: z.string().optional(),
  repBreakdown: z.record(z.string(), z.number()),
  disposition: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  startedAt: z.number().optional(),
  endedAt: z.number().optional(),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "invalid", detail: parsed.error.flatten() }, { status: 400 });
  }
  const b = parsed.data;

  let saved;
  const existing = b.callId
    ? (await db.select().from(callAttempts).where(eq(callAttempts.id, b.callId)))[0]
    : undefined;

  if (existing) {
    // Bridged call: attach the rep's conversation breakdown to the dialer record.
    [saved] = await db
      .update(callAttempts)
      .set({
        repBreakdown: b.repBreakdown,
        disposition: b.disposition ?? existing.disposition,
        repNote: b.note ?? null,
        endedAt: b.endedAt ? new Date(b.endedAt) : new Date(),
      })
      .where(eq(callAttempts.id, b.callId!))
      .returning();
  } else {
    // Manual call: standalone record (no dialer lead/campaign required).
    [saved] = await db
      .insert(callAttempts)
      .values({
        leadId: b.leadId ?? null,
        campaignId: b.campaignId ?? null,
        phone: b.phone ?? "",
        repId: b.repId,
        source: b.callId ? "dialer" : "manual",
        reachedHuman: (b.repBreakdown.right || 0) > 0,
        repBreakdown: b.repBreakdown,
        disposition: b.disposition ?? null,
        repNote: b.note ?? null,
        startedAt: b.startedAt ? new Date(b.startedAt) : new Date(),
        endedAt: b.endedAt ? new Date(b.endedAt) : new Date(),
      })
      .returning();
  }

  // ── Pipeline integration (design §6) ──────────────────────────────────────
  // Manual console call → record a "called" write in the persistent ledger so
  // the number is never re-dialed accidentally. Dialer calls already record on
  // dial-release (engine.ts).
  if (!existing && b.phone) {
    await recordCalled(b.phone, b.leadId ?? undefined);
  }

  const leadId = b.leadId;
  if (leadId && saved) {
    // A completed call satisfies any pending call follow-up for this lead. Do
    // this BEFORE logOutcome so a new callback follow-up it may create is not
    // itself immediately marked done.
    await completePendingCallFollowUps(leadId);

    // Map the rep disposition → outcome template and log it to the lead timeline.
    const disp = b.disposition ?? null;
    const templateKey = disp ? DISPOSITION_TO_TEMPLATE[disp] : undefined;
    const template = templateKey
      ? OUTCOME_TEMPLATES.find((t) => t.key === templateKey)
      : undefined;
    const note = b.note?.trim();
    const body = note || template?.body || "Call logged from console.";
    // Callback disposition auto-schedules a call follow-up +24h (design §6).
    const followUp =
      disp === "callback"
        ? {
            channel: "call" as const,
            dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            note: "Callback requested from console",
          }
        : undefined;
    await logOutcome(leadId, {
      templateKey: template?.key,
      body,
      repId: b.repId,
      callAttemptId: saved.id,
      followUp,
    });
  }

  // Optional server-side Google Sheets append (auto-log). See SHEETS_SETUP.md.
  const url = process.env.SHEET_WEBHOOK_URL;
  if (url && saved && !saved.syncedToSheet) {
    const ok = await appendToSheet(url, saved).catch(() => false);
    if (ok) {
      await db
        .update(callAttempts)
        .set({ syncedToSheet: true })
        .where(eq(callAttempts.id, saved.id));
    }
  }

  return Response.json({ ok: true, id: saved?.id });
}

async function appendToSheet(
  url: string,
  c: typeof callAttempts.$inferSelect,
): Promise<boolean> {
  const acc = toAcc(c.timeline, c.holdMs, c.repBreakdown);
  const secs = (ms: number) => Math.round((ms || 0) / 1000);
  const total = Object.values(acc).reduce((s, v) => s + v, 0);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      type: "call",
      call: {
        id: c.id,
        started: c.startedAt.toISOString(),
        ended: (c.endedAt ?? c.startedAt).toISOString(),
        ringing_s: secs(acc.ringing),
        waiting_s: secs(acc.waiting),
        right_s: secs(acc.right),
        wrong_s: secs(acc.wrong),
        voicemail_s: secs(acc.voicemail),
        noanswer_s: secs(acc.noanswer),
        total_s: secs(total),
        disposition: c.disposition ?? "",
        note: c.repNote ?? "",
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  return !!data.ok;
}
