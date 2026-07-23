"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Call, Device as TDevice } from "@twilio/voice-sdk";
import { Button } from "@/components/ui/button";
import { Phone, PhoneOff, Mic, MicOff, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

type Status = "connecting" | "online" | "offline" | "error";

/**
 * In-browser softphone for a logged-in rep (Twilio Voice SDK). Registers with a
 * token from /api/telephony/token, heartbeats presence, and answers calls the
 * dialer bridges to this rep — no physical phone needed. Presence follows this
 * being live: registered + heartbeating = available.
 */
export function Softphone() {
  const [status, setStatus] = useState<Status>("connecting");
  const [error, setError] = useState("");
  const [incoming, setIncoming] = useState<Call | null>(null);
  const [active, setActive] = useState<Call | null>(null);
  const [muted, setMuted] = useState(false);
  const [nonce, setNonce] = useState(0); // bump to force a reconnect
  const deviceRef = useRef<TDevice | null>(null);

  const heartbeat = useCallback((online: boolean) => {
    fetch("/api/telephony/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ online }),
      keepalive: !online,
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let device: TDevice | null = null;
    let hb: ReturnType<typeof setInterval> | null = null;
    let disposed = false;

    (async () => {
      try {
        setStatus("connecting");
        setError("");
        const r = await fetch("/api/telephony/token").then((x) => x.json());
        if (disposed) return;
        if (r.error) {
          setStatus("error");
          setError(r.error);
          return;
        }
        const { Device } = await import("@twilio/voice-sdk");
        if (disposed) return;
        // Use the default "roaming" edge (auto-selects the nearest signaling
        // endpoint). An explicit edge pin can raise ConnectionError 53000 if that
        // specific edge is unreachable from the rep's network.
        device = new Device(r.token, { logLevel: "error" });
        deviceRef.current = device;

        device.on("registered", () => {
          if (disposed) return;
          setStatus("online");
          setError("");
          heartbeat(true);
          // Start the periodic presence heartbeat once (survives reconnects).
          if (!hb) hb = setInterval(() => heartbeat(true), 15000);
        });
        device.on("unregistered", () => {
          if (!disposed) setStatus("offline");
        });
        device.on("error", (e: { code?: number; message?: string }) => {
          if (disposed) return;
          // Show the code; the SDK auto-reconnects signaling on transient blips.
          console.error("[softphone] device error", e);
          const detail = `${e?.code ?? ""} ${e?.message ?? ""}`.trim();
          setError(detail || "Softphone connection error");
          // Only hard-fail on token/auth errors that won't self-heal. Signaling
          // errors (53000/31005/31009) are usually transient — the SDK
          // reconnects and re-emits "registered", so keep showing the last state.
          if (e?.code === 20101 || e?.code === 20104) setStatus("error");
        });
        device.on("incoming", (call: Call) => {
          call.on("cancel", () => setIncoming(null));
          call.on("disconnect", () => {
            setActive(null);
            setIncoming(null);
            setMuted(false);
          });
          // Auto-answer: an available rep takes dialer calls hands-free so the
          // customer isn't left in silence waiting for a click. The rep-ear
          // whisper (/twiml/rep-join <Say>) announces the lead before bridging.
          // (Any prior page interaction — logging in, picking a rep — satisfies
          // the browser's autoplay gesture requirement for call audio.)
          try {
            call.accept();
            setActive(call);
            setIncoming(null);
          } catch {
            // Fall back to a manual Answer button if auto-accept is blocked.
            setIncoming(call);
          }
        });
        device.on("tokenWillExpire", async () => {
          const rr = await fetch("/api/telephony/token").then((x) => x.json());
          if (rr.token) device?.updateToken(rr.token);
        });

        // Register with a few retries so a transient signaling blip (53000) at
        // startup self-heals instead of leaving the rep offline. The periodic
        // heartbeat is started by the "registered" handler once we're online.
        for (let attempt = 1; attempt <= 3 && !disposed; attempt++) {
          try {
            await device.register();
            break;
          } catch (e) {
            console.error(`[softphone] register attempt ${attempt} failed`, e);
            if (attempt === 3 || disposed) throw e;
            await new Promise((res) => setTimeout(res, 1500 * attempt));
          }
        }
      } catch (e) {
        if (!disposed) {
          setStatus("error");
          console.error("[softphone] register failed", e);
          // Twilio SDK rejections aren't always Error instances (some are plain
          // objects, some undefined) — extract defensively so a connect failure
          // never crashes the console page.
          const m =
            e instanceof Error
              ? e.message
              : e && typeof e === "object" && "message" in e
                ? String((e as { message?: unknown }).message)
                : String(e ?? "");
          setError(
            m || "Couldn't connect the softphone. Check Twilio Voice config.",
          );
        }
      }
    })();

    const onHide = () => heartbeat(false);
    window.addEventListener("pagehide", onHide);

    return () => {
      disposed = true;
      window.removeEventListener("pagehide", onHide);
      if (hb) clearInterval(hb);
      heartbeat(false);
      device?.destroy();
      deviceRef.current = null;
    };
  }, [heartbeat, nonce]);

  const accept = () => {
    if (!incoming) return;
    incoming.accept();
    setActive(incoming);
    setIncoming(null);
  };
  const reject = () => {
    incoming?.reject();
    setIncoming(null);
  };
  const hangup = () => {
    active?.disconnect();
    setActive(null);
  };
  const toggleMute = () => {
    if (!active) return;
    const m = !muted;
    active.mute(m);
    setMuted(m);
  };

  const dot =
    status === "online"
      ? "bg-emerald-500"
      : status === "error"
        ? "bg-red-500"
        : "bg-muted-foreground/40";

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <span className={cn("h-2.5 w-2.5 rounded-full", dot, status === "online" && "animate-pulse")} />
          <span className="font-medium">
            Softphone —{" "}
            {status === "online"
              ? "Online (available)"
              : status === "connecting"
                ? "Connecting…"
                : status === "error"
                  ? "Not connected"
                  : "Offline"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {active && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
              On a call
            </span>
          )}
          {(status === "error" || status === "offline") && (
            <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={() => setNonce((n) => n + 1)}>
              <RotateCw className="h-3.5 w-3.5" /> Reconnect
            </Button>
          )}
        </div>
      </div>

      {error && status !== "online" && (
        <p className="mt-2 text-xs text-red-600">{error}</p>
      )}

      {/* Incoming call */}
      {incoming && !active && (
        <div className="mt-3 flex items-center justify-between rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2">
          <span className="text-sm font-medium text-emerald-800">Incoming call…</span>
          <div className="flex gap-2">
            <Button size="sm" className="gap-1.5" onClick={accept}>
              <Phone className="h-3.5 w-3.5" /> Answer
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={reject}>
              <PhoneOff className="h-3.5 w-3.5" /> Decline
            </Button>
          </div>
        </div>
      )}

      {/* Active call controls */}
      {active && (
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={toggleMute}>
            {muted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
            {muted ? "Unmute" : "Mute"}
          </Button>
          <Button size="sm" variant="destructive" className="gap-1.5" onClick={hangup}>
            <PhoneOff className="h-3.5 w-3.5" /> Hang up
          </Button>
        </div>
      )}
    </div>
  );
}
