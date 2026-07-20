import type { TelephonyProvider } from "./provider";
import { TwilioTelephonyProvider } from "./twilio";
import { SimulatedTelephonyProvider } from "./simulated";
import { scenarioForNumber } from "./scenario-mix";

/**
 * Returns the real Twilio provider when credentials are configured, otherwise the
 * simulated provider. This is the single switch between "real calls" and "safe
 * simulation" — set the TWILIO_* + PUBLIC_URL env and calls go out for real.
 */
export function getTelephonyProvider(): {
  provider: TelephonyProvider;
  mode: "twilio" | "simulated";
} {
  const hasTwilio =
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_NUMBER &&
    process.env.PUBLIC_URL;

  if (hasTwilio) {
    return { provider: new TwilioTelephonyProvider(), mode: "twilio" };
  }
  return {
    provider: new SimulatedTelephonyProvider({
      scenarioFor: scenarioForNumber,
      repAnswerProbability: 0.9,
      repAnswerLatencyMs: 500,
      timeScale: 1,
    }),
    mode: "simulated",
  };
}
