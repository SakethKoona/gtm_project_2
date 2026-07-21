"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type MappableField =
  | "phone"
  | "name"
  | "company"
  | "timezone"
  | "source"
  | "consentBasis"
  | "notes";

const FIELDS: { key: MappableField; label: string; required?: boolean }[] = [
  { key: "phone", label: "Phone", required: true },
  { key: "consentBasis", label: "Consent basis", required: true },
  { key: "name", label: "Name" },
  { key: "company", label: "Company" },
  { key: "timezone", label: "Timezone" },
  { key: "source", label: "Source" },
  { key: "notes", label: "Notes" },
];

type UploadResp = {
  token: string;
  filename: string;
  headers: string[];
  rowCount: number;
  suggestedMapping: Partial<Record<MappableField, string>>;
  usedSavedTemplate: boolean;
};

type Summary = {
  rowCount: number;
  eligible: number;
  quarantined: number;
  blocked: number;
  invalid: number;
  duplicates: number;
};

type SampleRow = {
  rowIndex: number;
  name: string | null;
  company: string | null;
  phone: string | null;
  timezone: string | null;
  consentBasis: string | null;
  status: string;
  reason: string | null;
};

type ValidateResp = {
  filename: string;
  summary: Summary;
  sample: SampleRow[];
  sampleTruncated: boolean;
};

const STATUS_STYLE: Record<string, string> = {
  eligible: "bg-green-100 text-green-700",
  quarantined: "bg-amber-100 text-amber-700",
  blocked: "bg-red-100 text-red-700",
  invalid: "bg-secondary text-muted-foreground",
  duplicate: "bg-sky-100 text-sky-700",
};

const SELECT_CLASS =
  "w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring";

export default function IngestPage() {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [vendor, setVendor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [upload, setUpload] = useState<UploadResp | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<MappableField, string>>>(
    {},
  );
  const [report, setReport] = useState<ValidateResp | null>(null);
  const [committed, setCommitted] = useState<{
    batchId: string;
    summary: Summary;
  } | null>(null);

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a .csv or .xlsx file first.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/ingest/upload", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "upload failed");
      setUpload(data);
      setMapping(data.suggestedMapping ?? {});
      setStep(2);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleValidate() {
    if (!upload) return;
    setError(null);
    if (!mapping.phone || !mapping.consentBasis) {
      setError("Phone and Consent basis are required mappings.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/ingest/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: upload.token, mapping }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "validation failed");
      setReport(data);
      setStep(3);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCommit() {
    if (!upload) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/ingest/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: upload.token, mapping, vendor }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "commit failed");
      setCommitted(data);
      setStep(4);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStep(1);
    setUpload(null);
    setMapping({});
    setReport(null);
    setCommitted(null);
    setError(null);
    setVendor("");
  }

  return (
    <main className="mx-auto max-w-4xl p-8">
      <header className="rise" style={{ "--rise-delay": "80ms" } as React.CSSProperties}>
        <p className="eyebrow">Admin</p>
        <h1 className="font-display mt-1 text-2xl">Lead ingestion</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a vendor list → map columns → review the honest callable count →
          commit. No row is dial-eligible until you confirm.
        </p>
      </header>

      <div className="rise" style={{ "--rise-delay": "160ms" } as React.CSSProperties}>
        <Steps step={step} />
      </div>

      <div className="rise" style={{ "--rise-delay": "240ms" } as React.CSSProperties}>
        {error && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-100/60 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {step === 1 && (
          <form onSubmit={handleUpload} className="mt-6 space-y-4">
            <label className="block text-sm font-medium">
              Vendor / source name (optional — remembers your column mapping)
              <Input
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                placeholder="e.g. AcmeListVendor"
                className="mt-1"
              />
            </label>
            <label className="block text-sm font-medium">
              Lead file (.csv / .xlsx)
              <Input
                type="file"
                name="file"
                accept=".csv,.xlsx,.xls"
                className="mt-1"
              />
            </label>
            <input type="hidden" name="vendor" value={vendor} />
            <Button type="submit" disabled={busy}>
              {busy ? "Parsing…" : "Upload & detect columns"}
            </Button>
          </form>
        )}

        {step === 2 && upload && (
          <div className="mt-6">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">{upload.filename}</strong> —{" "}
              {upload.rowCount.toLocaleString()} rows, {upload.headers.length}{" "}
              columns detected.
              {upload.usedSavedTemplate && (
                <span className="ml-2 rounded-md bg-sky-100 px-2 py-0.5 text-xs text-sky-700">
                  auto-mapped from saved template
                </span>
              )}
            </p>
            <div className="mt-4 space-y-3">
              {FIELDS.map((f) => (
                <div key={f.key} className="flex items-center gap-3">
                  <label className="w-40 text-sm font-medium">
                    {f.label}
                    {f.required && <span className="text-destructive"> *</span>}
                  </label>
                  <select
                    value={mapping[f.key] ?? ""}
                    onChange={(e) =>
                      setMapping((m) => ({
                        ...m,
                        [f.key]: e.target.value || undefined,
                      }))
                    }
                    className={`flex-1 ${SELECT_CLASS}`}
                  >
                    <option value="">— not mapped —</option>
                    {upload.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div className="mt-6 flex gap-3">
              <Button onClick={handleValidate} disabled={busy}>
                {busy ? "Validating…" : "Validate & preview report"}
              </Button>
              <Button onClick={reset} variant="outline">
                Start over
              </Button>
            </div>
          </div>
        )}

        {step === 3 && report && (
          <div className="mt-6">
            <h2 className="font-display text-lg">Pre-import report</h2>
            <p className="text-sm text-muted-foreground">
              {report.summary.rowCount.toLocaleString()} rows uploaded →{" "}
              <strong className="text-green-700">
                {report.summary.eligible.toLocaleString()} actually callable
              </strong>
              .
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Stat label="Eligible" value={report.summary.eligible} tone="green" />
              <Stat
                label="Quarantined"
                value={report.summary.quarantined}
                tone="amber"
              />
              <Stat label="DNC blocked" value={report.summary.blocked} tone="red" />
              <Stat label="Invalid" value={report.summary.invalid} tone="neutral" />
              <Stat
                label="Duplicates"
                value={report.summary.duplicates}
                tone="sky"
              />
            </div>

            <div className="mt-6 overflow-x-auto rounded-md border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Phone (E.164)</th>
                    <th className="px-3 py-2">Timezone</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {report.sample.map((r) => (
                    <tr
                      key={r.rowIndex}
                      className="border-t border-border/60 transition-colors hover:bg-muted/50"
                    >
                      <td className="px-3 py-2">{r.name ?? "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs tabular-nums">
                        {r.phone ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-xs">{r.timezone ?? "—"}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                            STATUS_STYLE[r.status] ??
                            "bg-secondary text-muted-foreground"
                          }`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {r.reason ?? ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {report.sampleTruncated && (
              <p className="mt-2 text-xs text-muted-foreground">
                Showing first {report.sample.length} rows. All rows are validated;
                the full breakdown is committed to the audit trail.
              </p>
            )}

            <div className="mt-6 flex gap-3">
              <Button onClick={handleCommit} disabled={busy}>
                {busy
                  ? "Committing…"
                  : `Confirm & commit ${report.summary.eligible.toLocaleString()} eligible leads`}
              </Button>
              <Button onClick={() => setStep(2)} variant="outline">
                Back to mapping
              </Button>
            </div>
          </div>
        )}

        {step === 4 && committed && (
          <div className="mt-6 rounded-md border border-green-200 bg-green-100/60 p-6">
            <h2 className="font-display text-lg text-green-700">Import committed</h2>
            <p className="mt-1 text-sm text-green-700">
              Batch <span className="font-mono">{committed.batchId}</span> —{" "}
              {committed.summary.eligible.toLocaleString()} eligible leads are now
              dial-ready.{" "}
              {(
                committed.summary.quarantined +
                committed.summary.blocked +
                committed.summary.invalid +
                committed.summary.duplicates
              ).toLocaleString()}{" "}
              rows retained with rejection reasons for the audit trail.
            </p>
            <Button onClick={reset} className="mt-4">
              Upload another list
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}

function Steps({ step }: { step: number }) {
  const labels = ["Upload", "Map columns", "Review", "Done"];
  return (
    <ol className="mt-6 flex flex-wrap gap-2 text-sm">
      {labels.map((label, i) => {
        const n = i + 1;
        const active = step === n;
        const done = step > n;
        return (
          <li
            key={label}
            className={`flex items-center gap-2 rounded-md px-3 py-1 font-medium transition-colors ${
              active
                ? "bg-primary text-primary-foreground"
                : done
                  ? "bg-green-100 text-green-700"
                  : "bg-secondary text-muted-foreground"
            }`}
          >
            <span className="font-mono text-xs tabular-nums">
              {done ? "✓" : n}
            </span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "green" | "amber" | "red" | "neutral" | "sky";
}) {
  const tones: Record<string, string> = {
    green: "text-green-700",
    amber: "text-amber-700",
    red: "text-red-700",
    neutral: "text-foreground",
    sky: "text-sky-700",
  };
  return (
    <div className="rounded-xl bg-card p-3 ring-1 ring-foreground/10">
      <div className={`font-display text-lg tabular-nums ${tones[tone]}`}>
        {value.toLocaleString()}
      </div>
      <div className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
    </div>
  );
}
