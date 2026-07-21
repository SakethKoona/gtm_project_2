"use client";

import { useState } from "react";

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
  eligible: "bg-emerald-100 text-emerald-800",
  quarantined: "bg-amber-100 text-amber-800",
  blocked: "bg-red-100 text-red-800",
  invalid: "bg-zinc-800 text-zinc-200",
  duplicate: "bg-sky-100 text-sky-800",
};

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
    <main className="mx-auto max-w-4xl p-8 font-sans">
      <h1 className="text-2xl font-semibold">Lead Ingestion</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Upload a vendor list → map columns → review the honest callable count →
        commit. No row is dial-eligible until you confirm.
      </p>

      <Steps step={step} />

      {error && (
        <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {step === 1 && (
        <form onSubmit={handleUpload} className="mt-6 space-y-4">
          <label className="block text-sm font-medium">
            Vendor / source name (optional — remembers your column mapping)
            <input
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="e.g. AcmeListVendor"
              className="mt-1 block w-full rounded-md border border-zinc-700 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm font-medium">
            Lead file (.csv / .xlsx)
            <input
              type="file"
              name="file"
              accept=".csv,.xlsx,.xls"
              className="mt-1 block w-full text-sm"
            />
          </label>
          <input type="hidden" name="vendor" value={vendor} />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Parsing…" : "Upload & detect columns"}
          </button>
        </form>
      )}

      {step === 2 && upload && (
        <div className="mt-6">
          <p className="text-sm text-zinc-300">
            <strong>{upload.filename}</strong> —{" "}
            {upload.rowCount.toLocaleString()} rows, {upload.headers.length}{" "}
            columns detected.
            {upload.usedSavedTemplate && (
              <span className="ml-2 rounded bg-sky-100 px-2 py-0.5 text-xs text-sky-800">
                auto-mapped from saved template
              </span>
            )}
          </p>
          <div className="mt-4 space-y-3">
            {FIELDS.map((f) => (
              <div key={f.key} className="flex items-center gap-3">
                <label className="w-40 text-sm font-medium">
                  {f.label}
                  {f.required && <span className="text-red-600"> *</span>}
                </label>
                <select
                  value={mapping[f.key] ?? ""}
                  onChange={(e) =>
                    setMapping((m) => ({
                      ...m,
                      [f.key]: e.target.value || undefined,
                    }))
                  }
                  className="flex-1 rounded-md border border-zinc-700 px-3 py-2 text-sm"
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
            <button
              onClick={handleValidate}
              disabled={busy}
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? "Validating…" : "Validate & preview report"}
            </button>
            <button
              onClick={reset}
              className="rounded-md border border-zinc-700 px-4 py-2 text-sm"
            >
              Start over
            </button>
          </div>
        </div>
      )}

      {step === 3 && report && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold">Pre-import report</h2>
          <p className="text-sm text-zinc-500">
            {report.summary.rowCount.toLocaleString()} rows uploaded →{" "}
            <strong className="text-emerald-700">
              {report.summary.eligible.toLocaleString()} actually callable
            </strong>
            .
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Eligible" value={report.summary.eligible} tone="emerald" />
            <Stat
              label="Quarantined"
              value={report.summary.quarantined}
              tone="amber"
            />
            <Stat label="DNC blocked" value={report.summary.blocked} tone="red" />
            <Stat label="Invalid" value={report.summary.invalid} tone="zinc" />
            <Stat
              label="Duplicates"
              value={report.summary.duplicates}
              tone="sky"
            />
          </div>

          <div className="mt-6 overflow-x-auto rounded-md border border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-900 text-xs uppercase text-zinc-500">
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
                  <tr key={r.rowIndex} className="border-t border-zinc-800">
                    <td className="px-3 py-2">{r.name ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.phone ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-xs">{r.timezone ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${
                          STATUS_STYLE[r.status] ?? "bg-zinc-800"
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-500">
                      {r.reason ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {report.sampleTruncated && (
            <p className="mt-2 text-xs text-zinc-400">
              Showing first {report.sample.length} rows. All rows are validated;
              the full breakdown is committed to the audit trail.
            </p>
          )}

          <div className="mt-6 flex gap-3">
            <button
              onClick={handleCommit}
              disabled={busy}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy
                ? "Committing…"
                : `Confirm & commit ${report.summary.eligible.toLocaleString()} eligible leads`}
            </button>
            <button
              onClick={() => setStep(2)}
              className="rounded-md border border-zinc-700 px-4 py-2 text-sm"
            >
              Back to mapping
            </button>
          </div>
        </div>
      )}

      {step === 4 && committed && (
        <div className="mt-6 rounded-md border border-emerald-300 bg-emerald-50 p-6">
          <h2 className="text-lg font-semibold text-emerald-800">
            Import committed
          </h2>
          <p className="mt-1 text-sm text-emerald-700">
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
          <button
            onClick={reset}
            className="mt-4 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
          >
            Upload another list
          </button>
        </div>
      )}
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
            className={`flex items-center gap-2 rounded-full px-3 py-1 ${
              active
                ? "bg-zinc-900 text-white"
                : done
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-zinc-800 text-zinc-500"
            }`}
          >
            <span className="font-mono text-xs">{done ? "✓" : n}</span>
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
  tone: "emerald" | "amber" | "red" | "zinc" | "sky";
}) {
  const tones: Record<string, string> = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    red: "border-red-200 bg-red-50 text-red-800",
    zinc: "border-zinc-800 bg-zinc-900 text-zinc-200",
    sky: "border-sky-200 bg-sky-50 text-sky-800",
  };
  return (
    <div className={`rounded-md border p-3 ${tones[tone]}`}>
      <div className="text-2xl font-semibold">{value.toLocaleString()}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}
