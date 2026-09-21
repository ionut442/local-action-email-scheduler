"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const OPTIONS = ["unclassified", "positive", "negative", "other", "automatic"] as const;

export function ClassifyButtons({ id, current }: { id: number; current: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function set(classification: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/replies", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, classification }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(`Failed: ${data.error ?? "unknown error"}`);
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap gap-1">
      {OPTIONS.map((o) => (
        <button
          key={o}
          disabled={busy}
          onClick={() => set(o)}
          title={`Mark as ${o}`}
          className={`rounded-full px-2 py-0.5 text-xs font-semibold disabled:opacity-50 ${
            current === o
              ? "bg-zinc-900 text-white"
              : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
          }`}
        >
          {o}
        </button>
      ))}
    </span>
  );
}

export function SyncRepliesButton({ label }: { label: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  async function run(backfill: boolean) {
    if (backfill && !window.confirm("Backfill replies from the last 30 days? Already-imported messages are skipped.")) {
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/replies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(backfill ? { backfillDays: 30 } : {}),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        setMsg(`Error: ${data.error ?? "sync failed"}`);
      } else if (data.reason === "imap_not_configured") {
        setMsg("IMAP is not configured. Set IMAP_HOST / IMAP_USER / IMAP_PASSWORD in Vercel env vars.");
      } else if (data.reason === "baseline_established") {
        setMsg("Baseline established at the newest mailbox message. Future syncs will import only newer mail; use Backfill to pull recent history.");
      } else {
        setMsg(`Checked ${data.checked}, imported ${data.imported} (${data.matched} matched, ${data.automatic} automatic).`);
      }
      router.refresh();
    } catch {
      setMsg("Error: request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        onClick={() => run(false)}
        disabled={busy}
        className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {busy ? "Syncing…" : label}
      </button>
      <button
        onClick={() => run(true)}
        disabled={busy}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-50"
      >
        Backfill 30 days
      </button>
      {msg && <span className="text-sm text-zinc-600">{msg}</span>}
    </span>
  );
}
