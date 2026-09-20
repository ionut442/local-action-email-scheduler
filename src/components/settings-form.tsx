"use client";

import { useEffect, useState } from "react";

interface Settings {
  subject: string;
  body: string;
  senderName: string;
  dailyLimit: number;
  sendingEnabled: boolean;
  bodyIsHtml: boolean;
}

export function SettingsForm() {
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Failed to load.");
        setS({
          subject: data.subject ?? "",
          body: data.body ?? "",
          senderName: data.senderName ?? "LocalAction",
          dailyLimit: data.dailyLimit ?? 30,
          sendingEnabled: data.sendingEnabled === true,
          bodyIsHtml: data.bodyIsHtml === true,
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load."));
  }, []);

  async function save() {
    if (!s) return;
    if (!Number.isInteger(s.dailyLimit) || s.dailyLimit < 1 || s.dailyLimit > 500) {
      setError("Daily limit must be an integer between 1 and 500.");
      return;
    }
    if (s.sendingEnabled && !window.confirm("Save with sending ON? The scheduler will send real emails.")) {
      return;
    }
    setSaving(true);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Save failed.");
      else setMsg("Settings saved.");
    } catch {
      setError("Save failed (network error).");
    } finally {
      setSaving(false);
    }
  }

  if (error && !s) return <p className="text-sm text-red-700">{error}</p>;
  if (!s) return <p className="text-sm text-zinc-500">Loading…</p>;

  return (
    <div className="max-w-xl space-y-4">
      <div className="flex items-center gap-3 rounded-md border border-zinc-200 p-3">
        <input
          id="sending"
          type="checkbox"
          checked={s.sendingEnabled}
          onChange={(e) => setS({ ...s, sendingEnabled: e.target.checked })}
          className="h-5 w-5"
        />
        <label htmlFor="sending" className="text-sm font-semibold">
          Email sending {s.sendingEnabled ? "ON" : "OFF"}
        </label>
      </div>
      <p className="-mt-2 text-xs text-zinc-500">
        Master switch. When OFF, the cron and “Run scheduler now” send nothing. Test emails
        always work.
      </p>
      <div>
        <label className="mb-1 block text-sm font-medium">Daily limit (1–500)</label>
        <input
          type="number"
          min={1}
          max={500}
          value={s.dailyLimit}
          onChange={(e) => setS({ ...s, dailyLimit: Number(e.target.value) })}
          className="w-40 rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Sender display name</label>
        <input
          value={s.senderName}
          onChange={(e) => setS({ ...s, senderName: e.target.value })}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
      </div>
      <button
        onClick={save}
        disabled={saving}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save settings"}
      </button>
      {msg && <p className="text-sm text-green-700">{msg}</p>}
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="rounded-md bg-zinc-50 p-3 text-xs text-zinc-500">
        SMTP credentials come only from environment variables and cannot be viewed or edited
        here.
      </div>
    </div>
  );
}
