import {
  getCampaign,
  listCampaignReps,
  listCampaignLeads,
} from "@/lib/campaigns/service";
import { campaignMetrics, recentCalls } from "@/lib/observability/metrics";
import { abandonmentRate } from "@/lib/dialer/abandonment";

export const dynamic = "force-dynamic";

/** Bundled dashboard snapshot for one campaign. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) return Response.json({ error: "not found" }, { status: 404 });

  const [reps, metrics, calls, abandon, campaignLeads] = await Promise.all([
    listCampaignReps(id),
    campaignMetrics(id, 60),
    recentCalls(id, 20),
    abandonmentRate(id),
    listCampaignLeads(id),
  ]);

  const freeReps = reps.filter(
    (r) => r.presence === "available" && !r.onCall,
  ).length;

  return Response.json({
    campaign,
    reps,
    freeReps,
    queueDepth: campaignLeads.length,
    metrics,
    abandonment: abandon,
    calls,
  });
}
