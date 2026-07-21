import { dialerBus, type DialerEvent } from "@/lib/dialer/events";
import { apiGuard } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

/**
 * Server-Sent Events stream of live dialer events for one campaign (screen-pops,
 * call-state changes, governor snapshots). The dashboard subscribes here.
 *
 * In-process pub/sub works when the orchestrator runs in the same Node process
 * (as it does for the in-app simulate trigger). Across separate always-on
 * workers, back dialerBus with Redis pub/sub — the event shapes are unchanged.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await apiGuard(["rep", "admin"]);
  if (!guard.ok) return guard.res;

  const { id } = await params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (e: DialerEvent) => {
        // Only forward events for this campaign.
        if ("campaignId" in e && e.campaignId !== id) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      };
      const unsub = dialerBus.subscribe(send);
      // Heartbeat so proxies don't close an idle stream.
      const hb = setInterval(() => {
        controller.enqueue(encoder.encode(`: ping\n\n`));
      }, 15000);
      // Clean up when the client disconnects.
      _req.signal.addEventListener("abort", () => {
        clearInterval(hb);
        unsub();
        try {
          controller.close();
        } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
