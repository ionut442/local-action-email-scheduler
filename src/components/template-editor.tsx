"use client";

import { useEffect, useState } from "react";
import { PLACEHOLDERS } from "@/lib/template-client";

interface Settings {
  subject: string;
  body: string;
  senderName: string;
  dailyLimit: number;
  sendingEnabled: boolean;
}

export function TemplateEditor() {
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);

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
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load."));
  }, []);

  async function save() {
    if (!s) return;
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
      else setMsg("Template saved — it will be used for all future emails.");
    } catch {
      setError("Save failed (network error).");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTestBusy(true);
    setTestMsg(null);
    try {
      const res = await fetch("/api/test-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testTo }),
      });
      const data = await res.json();
      setTestMsg(res.ok ? `Test email sent to ${testTo}.` : `Error: ${data.error}`);
    } catch {
      setTestMsg("Error: request failed.");
    } finally {
      setTestBusy(false);
    }
  }

  if (error && !s) return <p className="text-sm text-red-700">{error}</p>;
  if (!s) return <p className="text-sm text-zinc-500">Loading…</p>;

  const previewSubject = renderPreview(s.subject, true);
  const previewBody = renderPreview(s.body, false);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium">Sender display name</label>
          <input
            value={s.senderName}
            onChange={(e) => setS({ ...s, senderName: e.target.value })}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Subject</label>
          <input
            value={s.subject}
            onChange={(e) => setS({ ...s, subject: e.target.value })}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Email body (plain text)</label>
          <textarea
            value={s.body}
            onChange={(e) => setS({ ...s, body: e.target.value })}
            rows={14}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm"
          />
        </div>
        <div className="rounded-md bg-zinc-50 p-3 text-xs text-zinc-600">
          <p className="mb-1 font-semibold">Supported placeholders:</p>
          <div className="flex flex-wrap gap-1">
            {PLACEHOLDERS.map((p) => (
              <code key={p} className="rounded bg-zinc-200 px-1.5 py-0.5">
                {p}
              </code>
            ))}
          </div>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save template"}
        </button>
        {msg && <p className="text-sm text-green-700">{msg}</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}

        <div className="mt-4 rounded-md border border-zinc-200 p-3">
          <h3 className="text-sm font-semibold">Send test email</h3>
          <p className="mb-2 text-xs text-zinc-500">
            Test emails don&apos;t affect the daily limit or any contact.
          </p>
          <div className="flex gap-2">
            <input
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="you@example.com"
              type="email"
              className="flex-1 rounded-md border border-zinc-300 px-3 py-1.5 text-sm"
            />
            <button
              onClick={sendTest}
              disabled={testBusy || !testTo}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-50"
            >
              {testBusy ? "Sending…" : "Send test"}
            </button>
          </div>
          {testMsg && <p className="mt-2 text-sm text-zinc-700">{testMsg}</p>}
        </div>
      </div>

      <div>
        <h3 className="mb-1 text-sm font-medium text-zinc-500">Live preview</h3>
        <div className="rounded-md border border-zinc-200 bg-white">
          <div className="border-b border-zinc-100 px-4 py-3">
            <p className="text-xs text-zinc-500">From: {s.senderName || "LocalAction"}</p>
            <p className="font-semibold">{previewSubject || "(no subject)"}</p>
          </div>
          <div
            className="prose-sm px-4 py-3 text-sm"
            dangerouslySetInnerHTML={{ __html: previewBody }}
          />
          <div className="border-t border-zinc-100 px-4 py-2 text-xs text-zinc-400">
            You can opt out of future emails here: <span className="underline">Unsubscribe</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const SAMPLE: Record<string, string> = {
  business_name: "Example Business",
  email: "hello@example.com",
  website: "https://example.com",
  city: "Berlin",
  country: "Germany",
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPreview(template: string, isSubject: boolean): string {
  const rendered = template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k: string) => {
    const key = k.toLowerCase();
    return key in SAMPLE ? SAMPLE[key] : m;
  });
  if (isSubject) return esc(rendered);
  return esc(rendered)
    .split(/\n\n+/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}
