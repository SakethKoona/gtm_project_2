import { inArray, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contactLedger } from "@/db/schema";

/**
 * Contact ledger — THE persistent found/called log (spec §2). Keyed by phone
 * (E.164) so a duplicate number is never re-found on ingest nor re-called on
 * dial, across sessions, even if the originating lead row is later
 * quarantined/deleted. These are the only writers/readers of `contact_ledger`.
 */

/** A drizzle transaction handle, so callers can enroll ledger writes in a tx. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Record that a set of phones were "found" (ingested). Idempotent per phone:
 * the first claim wins (`onConflictDoNothing`), so re-ingesting a number never
 * disturbs its original provenance. Runs inside `tx` when supplied so it commits
 * atomically with the lead insert.
 */
export async function recordFound(
  phones: { phone: string; leadId: string }[],
  tx?: Tx,
): Promise<void> {
  if (phones.length === 0) return;
  const conn = tx ?? db;
  await conn
    .insert(contactLedger)
    .values(phones.map((p) => ({ phone: p.phone, leadId: p.leadId })))
    .onConflictDoNothing({ target: contactLedger.phone });
}

/**
 * Record that a phone was "called" (dial released / manual console call). Upserts
 * the ledger row: stamps firstCalledAt on the first-ever call, always bumps
 * lastCalledAt=now and callCount+1. leadId only fills a previously-null slot.
 */
export async function recordCalled(
  phone: string,
  leadId?: string,
  tx?: Tx,
): Promise<void> {
  const conn = tx ?? db;
  const now = new Date();
  await conn
    .insert(contactLedger)
    .values({
      phone,
      leadId: leadId ?? null,
      firstCalledAt: now,
      lastCalledAt: now,
      callCount: 1,
    })
    .onConflictDoUpdate({
      target: contactLedger.phone,
      set: {
        lastCalledAt: sql`now()`,
        callCount: sql`${contactLedger.callCount} + 1`,
        firstCalledAt: sql`coalesce(${contactLedger.firstCalledAt}, now())`,
        leadId: sql`coalesce(${contactLedger.leadId}, ${leadId ?? null})`,
      },
    });
}

/** Which of the given phones already exist in the ledger (found OR called). */
export async function phonesInLedger(phones: string[]): Promise<Set<string>> {
  if (phones.length === 0) return new Set();
  const rows = await db
    .select({ phone: contactLedger.phone })
    .from(contactLedger)
    .where(inArray(contactLedger.phone, phones));
  return new Set(rows.map((r) => r.phone));
}

/** True when this phone has been dialed at least once (callCount > 0). */
export async function hasBeenCalled(phone: string): Promise<boolean> {
  const [row] = await db
    .select({ callCount: contactLedger.callCount })
    .from(contactLedger)
    .where(eq(contactLedger.phone, phone))
    .limit(1);
  return (row?.callCount ?? 0) > 0;
}
