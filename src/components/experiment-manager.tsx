"use client";

import { useEffect, useState } from "react";
import { PLACEHOLDERS, SAMPLE_VARS } from "@/lib/template-client";

interface SubjectVar {
  id?: number;
  label: string;
  subject: string;
  enabled: boolean;
  sortOrder: number;
  sent?: number;
}

interface BodyVar {
  id?: number;
  label: string;
  bodyHtml: string;
  enabled: boolean;
  sortOrder: number;
  sent?: number;
}

interface CampaignData {
  campaigns: { id: number; name: string; mode: string; active: boolean }[];
  active: { id: number; name: string; mode: string; active: boolean } | null;
  subjects: SubjectVar[];
  bodies: BodyVar[];
  distribution: {
    subjects: { id: number; label: string; sent: number }[];
    bodies: { id: number; label: string; sent: number }[];
    combos: { sid: number; bid: number; sent: number }[];
    totalSent: number;
  } | null;
  signature: { html: string; text: string };
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Mirror of server renderTemplateHtml: values escaped, unknowns kept. */
function substituteHtml(template: string): string {
  const safe: Record<string, string> = {};
  for (const [k, v] of Object.entries(SAMPLE_VARS)) safe[k] = esc(v);
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k: string) => {
    const key = k.toLowerCase();
    return key in safe ? safe[key] : m;
  });
}

function substituteRaw(template: string): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k: string) => {
    const key = k.toLowerCase();
    return key in SAMPLE_VARS ? SAMPLE_VARS[key] : m;
  });
}

export function ExperimentManager() {
  const [data, setData] = useState<CampaignData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<"single" | "experiment">("experiment");
  const [active, setActive] = useState(false);
  const [name, setName] = useState("Product Research Campaign");
  const [subjects, setSubjects] = useState<SubjectVar[]>([]);
  const [bodies, setBodies] = useState<BodyVar[]>([]);
  const [sigHtml, setSigHtml] = useState("");
  const [sigText, setSigText] = useState("");
  const [editingBody, setEditingBody] = useState<number | null>(null);
  const [testS, setTestS] = useState(0);
  const [testB, setTestB] = useState(0);
  const [testTo, setTestTo] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  function applyData(d: CampaignData) {
    setData(d);
    if (d.active) {
      setMode(d.active.mode === "experiment" ? "experiment" : "single");
      setActive(d.active.active);
      setName(d.active.name);
      const sentByS = new Map((d.distribution?.subjects ?? []).map((s) => [s.id, s.sent]));
      const sentByB = new Map((d.distribution?.bodies ?? []).map((b) => [b.id, b.sent]));
      setSubjects(
        d.subjects.map((s, i) => ({ ...s, sortOrder: i, sent: s.id ? (sentByS.get(s.id) ?? 0) : 0 }))
      );
      setBodies(
        d.bodies.map((b, i) => ({ ...b, sortOrder: i, sent: b.id ? (sentByB.get(b.id) ?? 0) : 0 }))
      );
      if (d.subjects[0]?.id) setTestS((v) => v || d.subjects[0].id!);
      if (d.bodies[0]?.id) setTestB((v) => v || d.bodies[0].id!);
    } else {
      setSubjects(defaultSubjects());
      setBodies(defaultBodies());
    }
    setSigHtml(d.signature.html);
    setSigText(d.signature.text);
  }

  async function load() {
    setError(null);
    try {
      const r = await fetch("/api/campaigns");
      const d = (await r.json()) as CampaignData & { error?: string };
      if (!r.ok) throw new Error(d.error ?? "Failed to load.");
      applyData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    }
  }

  useEffect(() => {
    let alive = true;
    fetch("/api/campaigns")
      .then(async (r) => {
        const d = (await r.json()) as CampaignData & { error?: string };
        if (!r.ok) throw new Error(d.error ?? "Failed to load.");
        if (alive) applyData(d);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load.");
      });
    return () => {
      alive = false;
    };
  }, []);

  async function save() {
    setSaving(true);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: data?.active?.id,
          name,
          mode,
          active,
          subjects: subjects.map((s, i) => ({ ...s, sortOrder: i })),
          bodies: bodies.map((b, i) => ({ ...b, sortOrder: i })),
          signatureHtml: sigHtml,
          signatureText: sigText,
        }),
      });
      const d = await res.json();
      if (!res.ok) setError(d.error ?? "Save failed.");
      else {
        setMsg("Campaign saved.");
        await load();
      }
    } catch {
      setError("Save failed (network error).");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    if (!testS || !testB || !testTo) {
      setTestMsg("Pick a subject, a body and an address first.");
      return;
    }
    setTestBusy(true);
    setTestMsg(null);
    try {
      const res = await fetch("/api/test-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testTo, subjectVariantId: testS, bodyVariantId: testB }),
      });
      const d = await res.json();
      setTestMsg(res.ok ? `Test sent to ${testTo}.` : `Error: ${d.error}`);
    } catch {
      setTestMsg("Error: request failed.");
    } finally {
      setTestBusy(false);
    }
  }

  if (error && !data) return <p className="text-sm text-red-700">{error}</p>;
  if (!data) return <p className="text-sm text-zinc-500">Loading…</p>;

  const enabledS = subjects.filter((s) => s.enabled && s.subject.trim());
  const enabledB = bodies.filter((b) => b.enabled && b.bodyHtml.trim());
  const combos = enabledS.length * enabledB.length;
  const previewS = subjects.find((s) => s.id === testS) ?? enabledS[0];
  const previewB = bodies.find((b) => b.id === testB) ?? enabledB[0];
  const previewHtml = previewB ? substituteHtml(`${previewB.bodyHtml}\n${sigHtml}`) : "";
  const previewSubject = previewS
    ? substituteRaw(previewS.subject).replace(/<[^>]*>/g, "")
    : "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-zinc-200 p-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-64 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-semibold"
          aria-label="Campaign name"
        />
        <div className="flex rounded-md border border-zinc-300 text-xs">
          {(["single", "experiment"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-2.5 py-1.5 ${mode === m ? "bg-zinc-900 text-white" : "text-zinc-600"}`}
            >
              {m === "single" ? "Single Template" : "Variant Experiment"}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-4 w-4"
          />
          <span className="font-semibold">Active</span>
        </label>
        <button
          onClick={save}
          disabled={saving}
          className="ml-auto rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save campaign"}
        </button>
      </div>
      {msg && <p className="text-sm text-green-700">{msg}</p>}
      {error && <p className="text-sm text-red-700">{error}</p>}
      {mode === "single" && (
        <p className="text-sm text-zinc-500">
          Single-template mode: the scheduler uses the subject/body from the template editor
          above. Variant lists below are ignored until you switch to Variant Experiment.
        </p>
      )}

      {mode === "experiment" && (
        <>
          <div className="rounded-md border border-zinc-200 p-3 text-sm">
            <span className="font-semibold">Rotation: {active ? "ON" : "OFF (campaign not active)"}</span>
            <span className="ml-4 text-zinc-600">Active combinations: {combos}</span>
            <span className="ml-4 text-zinc-600">Sent: {data.distribution?.totalSent ?? 0}</span>
            {(data.distribution?.subjects.length ?? 0) > 0 && (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {data.distribution!.subjects.map((s) => (
                  <span key={s.id}>{s.label}: {s.sent}</span>
                ))}
                <span className="text-zinc-300">|</span>
                {data.distribution!.bodies.map((b) => (
                  <span key={b.id}>{b.label}: {b.sent}</span>
                ))}
              </div>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">Subjects</h3>
            <div className="space-y-2">
              {subjects.map((s, i) => (
                <div key={s.id ?? `new-${i}`} className="flex items-center gap-2">
                  <input
                    value={s.label}
                    onChange={(e) => {
                      const next = [...subjects];
                      next[i] = { ...s, label: e.target.value };
                      setSubjects(next);
                    }}
                    className="w-14 rounded-md border border-zinc-300 px-2 py-1.5 text-sm font-semibold"
                    aria-label="Subject label"
                  />
                  <input
                    value={s.subject}
                    onChange={(e) => {
                      const next = [...subjects];
                      next[i] = { ...s, subject: e.target.value };
                      setSubjects(next);
                    }}
                    placeholder="Subject… (supports {{business_name}}, {{trade}}…)"
                    className="flex-1 rounded-md border border-zinc-300 px-3 py-1.5 text-sm"
                  />
                  <label className="inline-flex items-center gap-1 text-xs text-zinc-600">
                    <input
                      type="checkbox"
                      checked={s.enabled}
                      onChange={(e) => {
                        const next = [...subjects];
                        next[i] = { ...s, enabled: e.target.checked };
                        setSubjects(next);
                      }}
                      className="h-4 w-4"
                    />
                    On
                  </label>
                  {(s.sent ?? 0) > 0 && (
                    <span className="text-xs text-zinc-500">sent {s.sent}</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">Bodies</h3>
            <div className="space-y-2">
              {bodies.map((b, i) => (
                <div key={b.id ?? `new-${i}`} className="rounded-md border border-zinc-200 p-2">
                  <div className="flex items-center gap-2">
                    <input
                      value={b.label}
                      onChange={(e) => {
                        const next = [...bodies];
                        next[i] = { ...b, label: e.target.value };
                        setBodies(next);
                      }}
                      className="w-14 rounded-md border border-zinc-300 px-2 py-1.5 text-sm font-semibold"
                      aria-label="Body label"
                    />
                    <span className="max-w-md flex-1 truncate text-xs text-zinc-500">
                      {b.bodyHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "(empty)"}
                    </span>
                    <label className="inline-flex items-center gap-1 text-xs text-zinc-600">
                      <input
                        type="checkbox"
                        checked={b.enabled}
                        onChange={(e) => {
                          const next = [...bodies];
                          next[i] = { ...b, enabled: e.target.checked };
                          setBodies(next);
                        }}
                        className="h-4 w-4"
                      />
                      On
                    </label>
                    {(b.sent ?? 0) > 0 && (
                      <span className="text-xs text-zinc-500">sent {b.sent}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => setEditingBody(editingBody === i ? null : i)}
                      className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50"
                    >
                      {editingBody === i ? "Close" : "Edit"}
                    </button>
                  </div>
                  {editingBody === i && (
                    <div className="mt-2 grid gap-2 lg:grid-cols-2">
                      <textarea
                        value={b.bodyHtml}
                        onChange={(e) => {
                          const next = [...bodies];
                          next[i] = { ...b, bodyHtml: e.target.value };
                          setBodies(next);
                        }}
                        rows={12}
                        className="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-xs"
                      />
                      <div>
                        <p className="mb-1 text-xs text-zinc-500">Preview (+ signature)</p>
                        <div
                          className="rounded-md border border-zinc-100 bg-white px-3 py-2 text-sm"
                          dangerouslySetInnerHTML={{ __html: substituteHtml(`${b.bodyHtml}\n${sigHtml}`) }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-md bg-zinc-50 p-3 text-xs text-zinc-600">
              <p className="mb-1 font-semibold">Supported placeholders in bodies:</p>
              <div className="flex flex-wrap gap-1">
                {PLACEHOLDERS.map((p) => (
                  <code key={p} className="rounded bg-zinc-200 px-1.5 py-0.5">{p}</code>
                ))}
              </div>
              <p className="mt-1">The global signature below is appended automatically — do not repeat it in bodies.</p>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">Global signature (auto-appended)</h3>
            <div className="grid gap-2 lg:grid-cols-2">
              <div>
                <p className="mb-1 text-xs text-zinc-500">HTML</p>
                <textarea
                  value={sigHtml}
                  onChange={(e) => setSigHtml(e.target.value)}
                  rows={6}
                  className="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-xs"
                />
              </div>
              <div>
                <p className="mb-1 text-xs text-zinc-500">Plain text (used in the text fallback)</p>
                <textarea
                  value={sigText}
                  onChange={(e) => setSigText(e.target.value)}
                  rows={6}
                  className="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-xs"
                />
              </div>
            </div>
          </div>

          <div className="rounded-md border border-zinc-200 p-3">
            <h3 className="mb-2 text-sm font-semibold">Test a combination</h3>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <select value={testS} onChange={(e) => setTestS(Number(e.target.value))} className="rounded-md border border-zinc-300 px-2 py-1.5">
                <option value={0}>Subject…</option>
                {subjects.filter((s) => s.id).map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
              <select value={testB} onChange={(e) => setTestB(Number(e.target.value))} className="rounded-md border border-zinc-300 px-2 py-1.5">
                <option value={0}>Body…</option>
                {bodies.filter((b) => b.id).map((b) => (
                  <option key={b.id} value={b.id}>{b.label}</option>
                ))}
              </select>
              <input
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder="you@example.com"
                type="email"
                className="rounded-md border border-zinc-300 px-3 py-1.5"
              />
              <button
                onClick={sendTest}
                disabled={testBusy}
                className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-50 disabled:opacity-50"
              >
                {testBusy ? "Sending…" : "Send test"}
              </button>
            </div>
            {testMsg && <p className="mt-2 text-sm text-zinc-700">{testMsg}</p>}
            {previewS && previewB && (
              <div className="mt-2 rounded-md border border-zinc-100">
                <div className="border-b border-zinc-100 px-3 py-2">
                  <p className="font-semibold text-sm">{previewSubject || "(no subject)"}</p>
                </div>
                <div className="px-3 py-2 text-sm" dangerouslySetInnerHTML={{ __html: previewHtml }} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function defaultSubjects(): SubjectVar[] {
  return [
    { label: "S1", subject: "A question about {{business_name}}", enabled: true, sortOrder: 0 },
    { label: "S2", subject: "Could I get your perspective as a {{trade}}?", enabled: true, sortOrder: 1 },
    { label: "S3", subject: "What is missing from the tools you use for your business?", enabled: true, sortOrder: 2 },
    { label: "S4", subject: "LocalAction product research: could I get your input?", enabled: true, sortOrder: 3 },
    { label: "S5", subject: "What still feels too manual in your business?", enabled: true, sortOrder: 4 },
  ];
}

function defaultBodies(): BodyVar[] {
  return [1, 2, 3, 4, 5].map((n) => ({
    label: `B${n}`,
    bodyHtml: `<p>Hi {{business_name}},</p>\n<p>[Replace this with body variant B${n}. Supports HTML, placeholders and lists.]</p>`,
    enabled: false,
    sortOrder: n - 1,
  }));
}
