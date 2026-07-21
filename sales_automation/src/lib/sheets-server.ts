import crypto from "crypto";
import { SHEET_HEADERS, type SheetRow } from "./sheets";

/**
 * Server-side Google Sheets sync via a service account — no third-party SDK.
 *
 * We sign a short-lived JWT with the service account's private key (Node crypto),
 * exchange it for an access token, and talk to the Sheets REST API directly. This
 * keeps the app dependency-free (nothing to `npm install`) and deploys anywhere
 * that runs Node.
 *
 * Setup is one-time (see SHEETS_SETUP.md): create a service account, drop its
 * email + private key in env, and share the target Sheet with that email. After
 * that the user just pastes the Sheet's normal URL — no Apps Script, no OAuth.
 *
 * Env:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL  — the ...@...iam.gserviceaccount.com address
 *   GOOGLE_PRIVATE_KEY            — its private key (literal \n or real newlines)
 */

const TAB = "Calls";
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

/** The service account address the user must share their Sheet with (not secret). */
export function serviceAccountEmail(): string | null {
  return process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim() || null;
}

export function credentialsConfigured(): boolean {
  return !!serviceAccountEmail() && !!process.env.GOOGLE_PRIVATE_KEY;
}

/** A typed error so the route can turn Google failures into friendly messages. */
export class SheetsError extends Error {
  constructor(
    public code:
      | "not_configured"
      | "bad_url"
      | "auth_failed"
      | "forbidden"
      | "not_found"
      | "api_error",
    message: string,
  ) {
    super(message);
  }
}

/** Pull a spreadsheet id out of a full URL, or accept a bare id. */
export function extractSpreadsheetId(input: string): string {
  const url = input.trim();
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(url)) return url; // already a bare id
  throw new SheetsError(
    "bad_url",
    "That doesn't look like a Google Sheet link. Paste the URL from your browser's address bar.",
  );
}

let cached: { token: string; exp: number } | null = null;

async function getAccessToken(): Promise<string> {
  const email = serviceAccountEmail();
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !rawKey) {
    throw new SheetsError(
      "not_configured",
      "Google Sheets sync isn't configured on the server. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY (see SHEETS_SETUP.md).",
    );
  }

  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp > now + 60) return cached.token;

  // Env stores the PEM with escaped newlines; restore them for the signer.
  const privateKey = rawKey.replace(/\\n/g, "\n");
  const enc = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  const header = enc({ alg: "RS256", typ: "JWT" });
  const claims = enc({
    iss: email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  });

  let signature: string;
  try {
    signature = crypto
      .createSign("RSA-SHA256")
      .update(`${header}.${claims}`)
      .sign(privateKey, "base64url");
  } catch {
    throw new SheetsError(
      "not_configured",
      "GOOGLE_PRIVATE_KEY is malformed — paste the full private key including the BEGIN/END lines.",
    );
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!res.ok || !data.access_token) {
    throw new SheetsError(
      "auth_failed",
      `Google rejected the service account credentials (${data.error ?? res.status}).`,
    );
  }

  cached = { token: data.access_token, exp: now + 3600 };
  return data.access_token;
}

async function api(
  token: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<Record<string, unknown>> {
  const res = await fetch(`${SHEETS_BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    if (res.status === 403) {
      // A 403 is either "API not enabled on the project" or "Sheet not shared".
      // Google's body distinguishes them; surface the right fix for each.
      if (/SERVICE_DISABLED|has not been used in project|accessNotConfigured/i.test(detail)) {
        const m = detail.match(/project[^\s]*?(\d{6,})/);
        const proj = m ? m[1] : "";
        throw new SheetsError(
          "forbidden",
          `The Google Sheets API isn't enabled for this service account's project${
            proj ? ` (${proj})` : ""
          }. Enable it at https://console.cloud.google.com/apis/library/sheets.googleapis.com${
            proj ? `?project=${proj}` : ""
          }, wait ~1 min, then try again.`,
        );
      }
      throw new SheetsError(
        "forbidden",
        `Share the Sheet with ${serviceAccountEmail()} (give it Editor access), then try again.`,
      );
    }
    if (res.status === 404) {
      throw new SheetsError(
        "not_found",
        "Sheet not found — double-check the link.",
      );
    }
    throw new SheetsError(
      "api_error",
      `Google Sheets API error (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}.`,
    );
  }
  return res.status === 204 ? {} : (res.json() as Promise<Record<string, unknown>>);
}

/** Verify we can reach + read the sheet (used by the "Test" button). */
export async function verifyAccess(sheetUrl: string): Promise<void> {
  const id = extractSpreadsheetId(sheetUrl);
  const token = await getAccessToken();
  await api(token, `/${id}?fields=spreadsheetId`);
}

/** Ensure the `Calls` tab exists and its header row is present. */
async function ensureTab(token: string, id: string): Promise<void> {
  const meta = (await api(
    token,
    `/${id}?fields=sheets.properties.title`,
  )) as { sheets?: { properties?: { title?: string } }[] };
  const titles = (meta.sheets ?? []).map((s) => s.properties?.title);
  if (!titles.includes(TAB)) {
    await api(token, `/${id}:batchUpdate`, {
      method: "POST",
      body: { requests: [{ addSheet: { properties: { title: TAB } } }] },
    });
  }
  const head = (await api(token, `/${id}/values/${TAB}!A1:A1`)) as {
    values?: string[][];
  };
  if (!head.values || head.values.length === 0) {
    await api(token, `/${id}/values/${TAB}!A1?valueInputOption=RAW`, {
      method: "PUT",
      body: { values: [SHEET_HEADERS] },
    });
  }
}

async function existingIds(token: string, id: string): Promise<Set<string>> {
  const r = (await api(token, `/${id}/values/${TAB}!A2:A`)) as {
    values?: string[][];
  };
  return new Set((r.values ?? []).map((row) => row[0]).filter(Boolean));
}

/**
 * Append the given rows to the Sheet, skipping any whose id is already present.
 * Returns the ids that are now in the sheet (newly appended + already-there), so
 * the caller can mark exactly those as synced. De-dupe makes retries safe.
 */
export async function appendRows(
  sheetUrl: string,
  rows: SheetRow[],
): Promise<string[]> {
  const id = extractSpreadsheetId(sheetUrl);
  const token = await getAccessToken();
  await ensureTab(token, id);

  const present = await existingIds(token, id);
  const fresh = rows.filter((r) => !present.has(String(r.id)));

  if (fresh.length > 0) {
    const values = fresh.map((r) => SHEET_HEADERS.map((h) => r[h]));
    await api(
      token,
      `/${id}/values/${TAB}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { method: "POST", body: { values } },
    );
  }

  // Every submitted row is now accounted for (either just written or a dup).
  return rows.map((r) => String(r.id));
}
