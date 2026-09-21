"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RunSchedulerButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const router = useRouter();

  async function run() {
    if (!window.confirm("Run the scheduler now? This sends real emails to pending contacts (up to the daily limit).")) {
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/run-scheduler", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setResult(`Error: ${data.error ?? "scheduler failed"}`);
      } else if (data.ran === false && data.reason === "sending_disabled") {
        setResult("Sending is OFF — nothing was sent. Enable it in Settings first.");
      } else if (data.reason === "waiting_interval" && data.nextSendAt) {
        setResult(
          `Not due yet — next email scheduled around ${new Date(data.nextSendAt).toLocaleString()}. One email goes out per run, spaced across the day.`
        );
      } else {
        setResult(
          `Done: ${data.sent} sent, ${data.failed} failed` +
            (data.reason ? ` (${data.reason})` : "") +
            (data.errors?.length ? ` — ${data.errors.slice(0, 3).join(" | ")}` : "")
        );
      }
      router.refresh();
    } catch {
      setResult("Error: request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        onClick={run}
        disabled={busy}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {busy ? "Running…" : "Run scheduler now"}
      </button>
      {result && <p className="mt-2 text-sm text-zinc-600">{result}</p>}
    </div>
  );
}

export function SendingToggle({
  initial,
  dailyLimit,
  subject,
  body,
  senderName,
  bodyIsHtml,
  signatureHtml,
  signatureText,
}: {
  initial: boolean;
  dailyLimit: number;
  subject: string;
  body: string;
  senderName: string;
  bodyIsHtml: boolean;
  signatureHtml: string;
  signatureText: string;
}) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function toggle() {
    const next = !on;
    if (next && !window.confirm("Turn email sending ON? The scheduler will start sending real emails.")) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body, senderName, dailyLimit, sendingEnabled: next, bodyIsHtml, signatureHtml, signatureText }),
      });
      if (res.ok) {
        setOn(next);
        router.refresh();
      } else {
        const data = await res.json();
        alert(`Failed: ${data.error ?? "unknown error"}`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${on ? "bg-green-600" : "bg-zinc-300"}`}
      role="switch"
      aria-checked={on}
      aria-label="Email sending on/off"
      title={on ? "Sending is ON — click to turn off" : "Sending is OFF — click to turn on"}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${on ? "translate-x-6" : "translate-x-1"}`}
      />
    </button>
  );
}
