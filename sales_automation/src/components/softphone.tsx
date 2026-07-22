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
        device = new Device(r.token, {
          logLevel: "error",
          // Pin a US signaling edge (fall back to auto) in case roaming selection
          // is the connection problem.
          edge: ["ashburn", "roaming"],
        });
        deviceRef.current = device;

        device.on("registered", () => {
          if (disposed) return;
          setStatus("online");
          setError("");
          heartbeat(true);
        });
        device.on("unregistered", () => {
          if (!disposed) setStatus("offline");
        });
        device.on("error", (e: { code?: number; message?: string }) => {
          if (disposed) return;
          // Show the code; the SDK auto-reconnects signaling on transient blips.
          setError(`${e.code ?? ""} ${e.message ?? String(e)}`.trim());
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

        await device.register();
        hb = setInterval(() => heartbeat(true), 15000);
      } catch (e) {
        if (!disposed) {
          setStatus("error");
          setError((e as Error).message);
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
