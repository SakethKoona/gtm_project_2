import { z } from "zod";
import { addRep, setRepPresence } from "@/lib/campaigns/service";
import { apiGuard } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

const addSchema = z.object({ name: z.string().min(1), phone: z.string().min(1) });
const patchSchema = z.object({
  repId: z.string(),
  presence: z.enum(["available", "away"]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await apiGuard(["admin"]);
  if (!guard.ok) return guard.res;

  const { id } = await params;
  const parsed = addSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  const rep = await addRep({ ...parsed.data, campaignId: id });
  return Response.json({ rep });
}

/** Toggle rep presence (feeds freeReps for the governor). */
export async function PATCH(request: Request) {
  const guard = await apiGuard(["rep", "admin"]);
  if (!guard.ok) return guard.res;

  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  await setRepPresence(parsed.data.repId, parsed.data.presence);
  return Response.json({ ok: true });
}
