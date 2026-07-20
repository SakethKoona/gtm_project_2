import type { Call, CurrentCall } from "./types";

/**
 * localStorage persistence. This is the seam to swap for a real backend later
 * (e.g. a Next.js API route + database) when you add accounts / multi-device.
 * Keep the same shapes and the rest of the app won't care.
 */

const K_CALLS = "att.calls.v1";
const K_CURRENT = "att.current.v1";
const K_SYNC = "att.syncUrl.v1";

export function loadCalls(): Call[] {
  try {
    return JSON.parse(localStorage.getItem(K_CALLS) || "[]") as Call[];
  } catch {
    return [];
  }
}
export function saveCalls(calls: Call[]): void {
  localStorage.setItem(K_CALLS, JSON.stringify(calls));
}

export function loadCurrent(): CurrentCall | null {
  try {
    const c = JSON.parse(localStorage.getItem(K_CURRENT) || "null");
    return c && c.acc ? (c as CurrentCall) : null;
  } catch {
    return null;
  }
}
export function saveCurrent(c: CurrentCall): void {
  localStorage.setItem(K_CURRENT, JSON.stringify(c));
}

export function loadSyncUrl(): string {
  return localStorage.getItem(K_SYNC) || "";
}
export function saveSyncUrl(url: string): void {
  localStorage.setItem(K_SYNC, url);
}
