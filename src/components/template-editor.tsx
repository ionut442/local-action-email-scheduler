"use client";

import { useEffect, useRef, useState } from "react";
import { PLACEHOLDERS, SAMPLE_VARS } from "@/lib/template-client";

interface Settings {
  subject: string;
  body: string;
  senderName: string;
  dailyLimit: number;
  sendingEnabled: boolean;
  bodyIsHtml: boolean;
  signatureHtml: string;
  signatureText: string;
}

export function TemplateEditor() {
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Failed to load.");
        setS({
          subject: data.subject ?? "",
          body: data.body ?? "",
          senderName: data.senderName ?? "Denis Oproiu",
          dailyLimit: data.dailyLimit ?? 30,
          sendingEnabled: data.sendingEnabled === true,
          bodyIsHtml: data.bodyIsHtml === true,
          signatureHtml: data.signatureHtml ?? "",
          signatureText: data.signatureText ?? "",
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load."));
  }, []);

  function wrapSelection(before: string, after = "") {
    const el = bodyRef.current;
    if (!el || !s) return;
    const start = el.selectionStart ?? s.body.length;
    const end = el.selectionEnd ?? s.body.length;
    const selected = s.body.slice(start, end) || "text";
    const next = s.body.slice(0, start) + before + selected + after + s.body.slice(end);
    setS({ ...s, body: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  }

  function insertLink() {
    const url = window.prompt("Link URL (https://…):", "https://");
    if (!url) return;
    const safe = url.replace(/"/g, "%22");
    wrapSelection(`<a href="${safe}">`, "</a>");
  }

  function toolbarAction(action: string) {
    switch (action) {
      case "bold":
        wrapSelection("<b>", "</b>");
        break;
      case "italic":
        wrapSelection("<i>", "</i>");
        break;
      case "underline":
        wrapSelection("<u>", "</u>");
        break;
      case "link":
        insertLink();
        break;
      case "heading":
        wrapSelection("<h2>", "</h2>");
        break;
      case "list":
        insertList();
        break;
      case "break":
        wrapSelection("<br>");
        break;
    }
  }

  const TOOLBAR: { label: string; title: string; action: string }[] = [
    { label: "B", title: "Bold", action: "bold" },
    { label: "I", title: "Italic", action: "italic" },
    { label: "U", title: "Underline", action: "underline" },
    { label: "Link", title: "Insert link", action: "link" },
    { label: "H2", title: "Heading", action: "heading" },
    { label: "• List", title: "Bullet list", action: "list" },
    { label: "¶ Break", title: "Line break", action: "break" },
  ];

  function insertList() {
    const el = bodyRef.current;
    if (!el || !s) return;
    const start = el.selectionStart ?? s.body.length;
    const end = el.selectionEnd ?? s.body.length;
    const selected = s.body.slice(start, end) || "First item\nSecond item";
    const items = selected
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => `  <li>${l}</li>`)
      .join("\n");
    const next = s.body.slice(0, start) + `<ul>\n${items}\n</ul>` + s.body.slice(end);
    setS({ ...s, body: next });
  }

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

  const previewSubject = renderPreviewSubject(s.subject);
  const previewBody = s.bodyIsHtml
    ? renderPreviewHtml(s.body)
    : renderPreviewText(s.body);

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
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-sm font-medium">Email body</label>
            <div className="flex rounded-md border border-zinc-300 text-xs">
              <button
                type="button"
                onClick={() => setS({ ...s, bodyIsHtml: false })}
                className={`px-2.5 py-1 ${!s.bodyIsHtml ? "bg-zinc-900 text-white" : "text-zinc-600"}`}
              >
                Plain text
              </button>
              <button
                type="button"
                onClick={() => setS({ ...s, bodyIsHtml: true })}
                className={`px-2.5 py-1 ${s.bodyIsHtml ? "bg-zinc-900 text-white" : "text-zinc-600"}`}
              >
                HTML
              </button>
            </div>
          </div>
          {s.bodyIsHtml && (
            <div className="mb-1 flex flex-wrap gap-1">
              {TOOLBAR.map((b) => (
                <button
                  key={b.label}
                  type="button"
                  title={b.title}
                  onClick={() => toolbarAction(b.action)}
                  className="rounded border border-zinc-300 px-2 py-0.5 text-xs font-semibold hover:bg-zinc-50"
                >
                  {b.label}
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={bodyRef}
            value={s.body}
            onChange={(e) => setS({ ...s, body: e.target.value })}
            rows={14}
            placeholder={
              s.bodyIsHtml
                ? "<p>Hi {{business_name}},</p>\n<p>We help …</p>"
                : "Hi {{business_name}},\n\nWe help …"
            }
            className="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm"
          />
          <p className="mt-1 text-xs text-zinc-500">
            {s.bodyIsHtml
              ? "HTML mode: tags are sent as-is. The plain-text version is generated automatically."
              : "Plain-text mode: line breaks become paragraphs, links become clickable."}
          </p>
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
            Test emails send the last <strong>saved</strong> template and don&apos;t affect
            the daily limit or any contact.
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
            <p className="text-xs text-zinc-500">From: {s.senderName || "Denis Oproiu"}</p>
            <p className="font-semibold">{previewSubject || "(no subject)"}</p>
          </div>
          <div
            className="prose-sm px-4 py-3 text-sm"
            dangerouslySetInnerHTML={{ __html: previewBody }}
          />
        </div>
      </div>
    </div>
  );
}

function substitute(template: string): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k: string) => {
    const key = k.toLowerCase();
    return key in SAMPLE_VARS ? SAMPLE_VARS[key] : m;
  });
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPreviewSubject(template: string): string {
  return esc(substitute(template).replace(/<[^>]*>/g, ""));
}

function renderPreviewText(template: string): string {
  return esc(substitute(template))
    .split(/\n\n+/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

function renderPreviewHtml(template: string): string {
  return substitute(template);
}
