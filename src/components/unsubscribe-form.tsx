"use client";

import { useState } from "react";

export function UnsubscribeForm({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Unsubscribe failed.");
      else setDone(true);
    } catch {
      setError("Request failed (network error).");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-md bg-green-50 p-4 text-sm text-green-800">
        You have been unsubscribed. You will not receive any more emails from us.
      </div>
    );
  }

  return (
    <div>
      <p className="mb-4 text-sm text-zinc-600">
        Click below to opt out of all future emails from LocalAction.
      </p>
      <button
        onClick={confirm}
        disabled={busy}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {busy ? "Working…" : "Unsubscribe me"}
      </button>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
