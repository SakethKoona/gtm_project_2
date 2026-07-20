import { EventEmitter } from "node:events";

/**
 * In-process event bus for live dashboard updates (screen-pops, call state
 * changes, governor snapshots). The dashboard websocket subscribes; the
 * orchestrator publishes. Production would back this with Redis pub/sub so
 * events fan out across multiple orchestrator processes — same event shapes.
 */

export type ScreenPop = {
  type: "screen_pop";
  callId: string;
  campaignId: string;
  lead: {
    id: string;
    name: string | null;
    company: string | null;
    phone: string;
    source: string | null;
    notes: string | null;
  };
  at: string;
};

export type CallStateChanged = {
  type: "call_state";
  callId: string;
  campaignId: string;
  state: string;
  at: string;
};

export type GovernorSnapshot = {
  type: "governor";
  campaignId: string;
  freeReps: number;
  overdialRatio: number;
  activeDials: number;
  cap: number;
  at: string;
};

/**
 * Fired when a live call is bridged to a specific rep. `callId` is the
 * `call_attempts` row id the rep console finalizes with its conversation
 * breakdown + disposition. The rep console filters these by its own `repId`.
 */
export type CallBridged = {
  type: "call_bridged";
  callId: string; // call_attempts id
  repId: string;
  campaignId: string;
  lead: {
    id: string;
    name: string | null;
    company: string | null;
    phone: string;
    notes: string | null;
  } | null;
  at: string;
};

export type DialerEvent =
  | ScreenPop
  | CallStateChanged
  | GovernorSnapshot
  | CallBridged;

class DialerBus extends EventEmitter {
  publish(event: DialerEvent) {
    this.emit("event", event);
  }
  subscribe(fn: (e: DialerEvent) => void) {
    this.on("event", fn);
    return () => this.off("event", fn);
  }
}

// Survive Next.js hot reloads by pinning to globalThis.
const g = globalThis as unknown as { __dialerBus?: DialerBus };
export const dialerBus = g.__dialerBus ?? (g.__dialerBus = new DialerBus());
