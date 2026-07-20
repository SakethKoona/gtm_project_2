import { db } from "@/db";
import { reps } from "@/db/schema";

export const dynamic = "force-dynamic";

/** All reps, for the console's rep picker (identity for now — no auth yet). */
export async function GET() {
  const rows = await db.select().from(reps).orderBy(reps.name);
  return Response.json({ reps: rows });
}
