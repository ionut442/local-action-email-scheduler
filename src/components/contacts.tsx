"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CsvUploader() {
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setSummary(null);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/contacts/import", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Import failed.");
      } else {
        setSummary(
          `${data.found} rows found — ${data.imported} imported, ${data.duplicatesSkipped} duplicates skipped, ${data.invalidSkipped} invalid emails skipped.`
        );
        router.refresh();
      }
    } catch {
      setError("Upload failed (network error).");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="cursor-pointer rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700">
        {busy ? "Importing…" : "Upload CSV"}
        <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} disabled={busy} />
      </label>
      <a
        href="/api/contacts/template"
        className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
      >
        Download CSV template
      </a>
      {summary && <p className="w-full text-sm text-green-700">{summary}</p>}
      {error && <p className="w-full text-sm text-red-700">{error}</p>}
    </div>
  );
}

export function RetryOneButton({ id }: { id: number }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function run() {
    setBusy(true);
    try {
      await fetch("/api/contacts/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      onClick={run}
      disabled={busy}
      className="rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
    >
      Retry
    </button>
  );
}

export function RetryAllButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  async function run() {
    if (!window.confirm("Move ALL failed contacts back to pending?")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/contacts/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allFailed: true }),
      });
      const data = await res.json();
      setMsg(res.ok ? "All failed contacts moved back to pending." : `Error: ${data.error}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={run}
        disabled={busy}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
      >
        Retry all failed
      </button>
      {msg && <span className="text-sm text-zinc-600">{msg}</span>}
    </span>
  );
}
