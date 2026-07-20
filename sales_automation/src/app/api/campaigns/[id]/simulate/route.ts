import { SimulatedTelephonyProvider } from "@/lib/telephony/simulated";
import { scenarioForNumber } from "@/lib/telephony/scenario-mix";
import { runCampaignDialer } from "@/lib/dialer/engine";

export const dynamic = "force-dynamic";
// Long-running: the batch drives simulated calls with real timers.
export const maxDuration = 300;

/**
 * Kick a simulated dial batch for this campaign IN-PROCESS, so the dashboard's
 * SSE stream shows live screen-pops / state changes / governor snapshots. This
 * is a demo affordance; in production the always-on dialer service runs the
 * engine instead of an HTTP request.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const provider = new SimulatedTelephonyProvider({
    scenarioFor: scenarioForNumber,
    repAnswerProbability: 0.9,
    repAnswerLatencyMs: 500,
    timeScale: 1,
  });

  // Fire-and-forget: return immediately; events stream over SSE as it runs.
  void runCampaignDialer({
    provider,
    campaignId: id,
    fromNumber: "+15550000000",
    talkTimeMs: 1500,
  }).catch((e) => console.error("simulate error", e));

  return Response.json({ started: true });
}
