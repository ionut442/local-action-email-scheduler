"use client";

import { useEffect, useState } from "react";
import { SyncRepliesButton } from "@/components/replies";

interface ImapStatus {
  configured: boolean;
  uidvalidity?: string | null;
  lastUid?: string | null;
  lastSyncAt?: string | null;
  lastError?: string | null;
  replyCount?: number;
}

export function ImapCard() {
  const [s, setS] = useState<ImapStatus | null>(null);
  const [testBusy, setTestBusy] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/imap/status")
      .then(async (r) => {
        const d = await r.json();
        if (r.ok && alive) setS(d);
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      alive = false;
    };
  }, []);

  async function test() {
    setTestBusy(true);
    setTestMsg(null);
    try {
      const res = await fetch("/api/imap/test", { method: "POST" });
      const d = await res.json();
      if (res.ok && d.ok) {
        setTestMsg(`Connected. INBOX has ${d.messages} messages (UIDVALIDITY ${d.uidvalidity}).`);
      } else {
        setTestMsg(`Failed: ${d.error ?? "unknown error"}`);
      }
    } catch {
      setTestMsg("Error: request failed.");
    } finally {
      setTestBusy(false);
    }
  }

  return (
    <div className="max-w-xl space-y-3 text-sm">
      {!s ? (
        <p className="text-zinc-500">Loading…</p>
      ) : !s.configured ? (
        <p className="rounded-md bg-amber-50 p-3 text-amber-800">
          IMAP is <strong>not configured</strong>. Set IMAP_HOST, IMAP_PORT, IMAP_SECURE,
          IMAP_USER and IMAP_PASSWORD in Vercel environment variables (never shown here).
          Sending works normally without it.
        </p>
      ) : (
        <dl className="space-y-1">
          <div className="flex gap-2">
            <dt className="w-32 text-zinc-500">Status</dt>
            <dd className="font-medium text-green-700">Configured</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-32 text-zinc-500">Last sync</dt>
            <dd>{s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleString() : "never"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-32 text-zinc-500">Cursor UID</dt>
            <dd>{s.lastUid ?? "—"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-32 text-zinc-500">Replies stored</dt>
            <dd>{s.replyCount ?? 0}</dd>
          </div>
          {s.lastError && (
            <div className="flex gap-2">
              <dt className="w-32 text-zinc-500">Last error</dt>
              <dd className="text-red-700">{s.lastError}</dd>
            </div>
          )}
        </dl>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={test}
          disabled={testBusy}
          className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-50 disabled:opacity-50"
        >
          {testBusy ? "Testing…" : "Test IMAP connection"}
        </button>
        <SyncRepliesButton label="Sync replies now" />
      </div>
      {testMsg && <p className="text-zinc-700">{testMsg}</p>}
    </div>
  );
}
