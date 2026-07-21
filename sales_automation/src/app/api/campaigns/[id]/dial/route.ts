export const dynamic = "force-dynamic";

/**
 * Trigger REAL dialing for this campaign. The always-on telephony server
 * (telephony-server/server.ts, default :4000) owns the Twilio webhooks + Media
 * Stream websocket, so the actual dial must run there — this route is a
 * same-origin proxy so the dashboard button can reach it without CORS.
 *
 * Set TELEPHONY_SERVER_URL if the telephony server isn't on localhost:4000.
 */
import { apiGuard } from "@/lib/auth/guards";

const TELEPHONY_SERVER_URL = (
  process.env.TELEPHONY_SERVER_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await apiGuard(["admin"]);
  if (!guard.ok) return guard.res;

  const { id } = await params;
  try {
    const res = await fetch(`${TELEPHONY_SERVER_URL}/dial/campaign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaignId: id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return Response.json(
        { error: data.error ?? `telephony server returned ${res.status}` },
        { status: 502 },
      );
    }
    return Response.json(data); // { started: true, mode: "twilio" }
  } catch {
    return Response.json(
      {
        error:
          "Could not reach the telephony server. Start it with `npm run telephony` (it must be running for real calls).",
      },
      { status: 502 },
    );
  }
}
