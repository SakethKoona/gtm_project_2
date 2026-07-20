import { assignEligibleLeads } from "@/lib/campaigns/service";

export const dynamic = "force-dynamic";

/** Pull unassigned dial-eligible leads into this campaign. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const assigned = await assignEligibleLeads(id);
  return Response.json({ assigned });
}
