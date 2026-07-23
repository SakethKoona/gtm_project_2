import { apiGuard } from "@/lib/auth/guards";
import { getUserById } from "@/lib/auth/users";
import { ensureBrowserRep } from "@/lib/campaigns/service";

export const dynamic = "force-dynamic";

/**
 * The logged-in user's own browser (softphone) rep — created on first request.
 * The console auto-selects this so a logged-in rep/admin's softphone activates
 * without picking anyone from a list. Identity is `rep_<userId>`.
 */
export async function GET() {
  const guard = await apiGuard(["rep", "admin"]);
  if (!guard.ok) return guard.res;

  const user = await getUserById(guard.userId);
  const name = user?.name ?? user?.email ?? "Rep";
  const rep = await ensureBrowserRep(guard.userId, name);
  return Response.json({ repId: rep.id, name: rep.name });
}
