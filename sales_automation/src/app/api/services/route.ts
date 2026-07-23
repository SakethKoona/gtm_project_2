import { z } from "zod";
import { apiGuard } from "@/lib/auth/guards";
import {
  listServiceStatus,
  setServiceEnabled,
  SERVICES,
} from "@/lib/services";
import { getLeadSheetConfig } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Admin Services panel API.
 *  - GET  → every worker's { enabled, alive, lastSeen, detail } + the linked lead sheet.
 *  - POST → flip a service's enabled (desired) state; the worker obeys on its next loop.
 */

export async function GET() {
  const guard = await apiGuard(["admin"]);
  if (!guard.ok) return guard.res;
  const cfg = await getLeadSheetConfig();
  return Response.json({
    services: await listServiceStatus(),
    leadSheet: { url: cfg.sheetUrl, tab: cfg.tab },
  });
}

const bodySchema = z.object({
  service: z.enum(SERVICES.map((s) => s.name) as [string, ...string[]]),
  enabled: z.boolean(),
});

export async function POST(request: Request) {
  const guard = await apiGuard(["admin"]);
  if (!guard.ok) return guard.res;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "invalid" }, { status: 400 });
  }
  await setServiceEnabled(
    parsed.data.service as (typeof SERVICES)[number]["name"],
    parsed.data.enabled,
  );
  return Response.json({ services: await listServiceStatus() });
}
