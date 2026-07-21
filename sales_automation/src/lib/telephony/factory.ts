import type { TelephonyProvider } from "./provider";
import { TwilioTelephonyProvider } from "./twilio";

/**
 * Returns the real Twilio telephony provider. Requires TWILIO_ACCOUNT_SID,
 * TWILIO_AUTH_TOKEN, TWILIO_NUMBER, and PUBLIC_URL to be set — there is no
 * simulated fallback. If Twilio isn't configured this throws, so a misconfigured
 * environment fails loudly instead of silently placing no real calls.
 */
export function getTelephonyProvider(): {
  provider: TelephonyProvider;
  mode: "twilio";
} {
  const missing = [
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_NUMBER",
    "PUBLIC_URL",
  ].filter((k) => !process.env[k]);

  if (missing.length > 0) {
    throw new Error(
      `Telephony is not configured. Set ${missing.join(", ")} in .env (see TELEPHONY_RUNBOOK.md).`,
    );
  }

  return { provider: new TwilioTelephonyProvider(), mode: "twilio" };
}

/** True when Twilio is fully configured (for preflight checks before dialing). */
export function isTelephonyConfigured(): boolean {
  return (
    !!process.env.TWILIO_ACCOUNT_SID &&
    !!process.env.TWILIO_AUTH_TOKEN &&
    !!process.env.TWILIO_NUMBER &&
    !!process.env.PUBLIC_URL
  );
}
