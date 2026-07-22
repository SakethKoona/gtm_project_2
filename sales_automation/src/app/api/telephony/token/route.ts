import twilio from "twilio";
import { apiGuard } from "@/lib/auth/guards";
import { getUserById } from "@/lib/auth/users";
import { ensureBrowserRep, repClientIdentity } from "@/lib/campaigns/service";

export const dynamic = "force-dynamic";

/**
 * Mint a Twilio Voice access token for the logged-in rep's in-browser softphone.
 * The token's identity is `rep_<userId>`, which the dialer bridges calls to. Also
 * ensures a browser `reps` row exists for this user (created on first request).
 *
 * Needs env: TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET.
 */
export async function GET() {
  const guard = await apiGuard(["rep", "admin"]);
  if (!guard.ok) return guard.res;

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
  if (!accountSid || !apiKeySid || !apiKeySecret) {
    return Response.json(
      {
        error:
          "Browser calling isn't configured. Set TWILIO_API_KEY_SID and TWILIO_API_KEY_SECRET in .env (create a Standard API key in the Twilio console).",
      },
      { status: 503 },
    );
  }

  const user = await getUserById(guard.userId);
  const name = user?.name ?? user?.email ?? "Rep";
  await ensureBrowserRep(guard.userId, name);

  const identity = repClientIdentity(guard.userId);
  const AccessToken = twilio.jwt.AccessToken;
  const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
    identity,
    ttl: 3600,
  });
  token.addGrant(new AccessToken.VoiceGrant({ incomingAllow: true }));

  return Response.json({ token: token.toJwt(), identity });
}
