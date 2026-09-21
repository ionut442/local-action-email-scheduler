import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/auth";
import { getCampaignResults, type VariantPerformance } from "@/lib/results";
import { Nav, Card } from "@/components/ui";

export const dynamic = "force-dynamic";

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function PerfTable({ rows, first }: { rows: VariantPerformance[]; first: string }) {
  const leader = rows.length > 0 ? rows[0] : null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
            <th className="py-2 pr-3">{first}</th>
            <th className="py-2 pr-3">Sent</th>
            <th className="py-2 pr-3">Replies</th>
            <th className="py-2 pr-3">Reply rate</th>
            <th className="py-2 pr-3">Positive</th>
            <th className="py-2 pr-3">Positive rate</th>
            <th className="py-2">Automatic</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-zinc-100">
              <td className="py-2 pr-3 font-medium">
                {r.label}
                {leader && r.id === leader.id && r.sent > 0 && (
                  <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">
                    Current leader
                  </span>
                )}
              </td>
              <td className="py-2 pr-3">{r.sent}</td>
              <td className="py-2 pr-3">{r.repliedContacts}</td>
              <td className="py-2 pr-3 font-semibold">{pct(r.replyRate)}</td>
              <td className="py-2 pr-3">{r.positiveContacts}</td>
              <td className="py-2 pr-3">{pct(r.positiveRate)}</td>
              <td className="py-2">{r.automaticCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function ResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string }>;
}) {
  if (!(await isAdminAuthenticated())) redirect("/login");
  const sp = await searchParams;

  let body: React.ReactNode;
  let loadError: string | null = null;
  let campaigns: { id: number; name: string; mode: string; active: boolean }[] = [];
  let selected: { id: number; name: string; mode: string; active: boolean } | null = null;
  let res: Awaited<ReturnType<typeof getCampaignResults>> | null = null;
  try {
    const { getCampaigns } = await import("@/lib/results");
    campaigns = await getCampaigns();
    const active = campaigns.find((c) => c.active) ?? null;
    const selectedId = Number(sp.campaign) || active?.id || campaigns[0]?.id;
    selected = campaigns.find((c) => c.id === selectedId) ?? null;
    if (selected) res = await getCampaignResults(selected.id);
  } catch (err) {
    loadError = err instanceof Error ? err.message : "unknown error";
  }

  if (loadError) {
    body = <p className="text-sm text-red-700">Could not load results: {loadError}</p>;
  } else if (!selected || !res) {
    body = <p className="text-sm text-zinc-500">No campaign yet. Create one on the Email page.</p>;
  } else {
    const comboByKey = new Map(res.combos.map((c) => [`${c.sid}:${c.bid}`, c]));
    body = (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-zinc-500">Campaign:</span>
            {campaigns.map((c) => (
              <Link
                key={c.id}
                href={`/results?campaign=${c.id}`}
                className={`rounded-md px-3 py-1.5 ${c.id === selected.id ? "bg-zinc-900 text-white" : "border border-zinc-300 hover:bg-zinc-50"}`}
              >
                {c.name || `Campaign ${c.id}`}
                {c.active ? " (active)" : ""}
              </Link>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Sent", value: String(res.totalSent) },
              { label: "Replied contacts", value: `${res.repliedContacts} (${pct(res.replyRate)})` },
              { label: "Positive", value: `${res.positiveContacts} (${pct(res.positiveRate)})` },
              { label: "Combinations", value: String(res.combos.length) },
            ].map((t) => (
              <div key={t.label} className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="text-xl font-bold">{t.value}</div>
                <div className="text-xs uppercase tracking-wide text-zinc-500">{t.label}</div>
              </div>
            ))}
          </div>
          <Card title="Subject performance (reply rate = unique replied contacts / sent)">
            {res.subjects.length === 0 ? (
              <p className="text-sm text-zinc-500">No sends yet.</p>
            ) : (
              <PerfTable rows={res.subjects} first="Subject" />
            )}
          </Card>
          <Card title="Body performance">
            {res.bodies.length === 0 ? (
              <p className="text-sm text-zinc-500">No sends yet.</p>
            ) : (
              <PerfTable rows={res.bodies} first="Body" />
            )}
          </Card>
          <Card title="Combination performance">
            {res.combos.length === 0 ? (
              <p className="text-sm text-zinc-500">No sends yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                      <th className="py-2 pr-3">Combination</th>
                      <th className="py-2 pr-3">Sent</th>
                      <th className="py-2 pr-3">Replies</th>
                      <th className="py-2 pr-3">Reply rate</th>
                      <th className="py-2 pr-3">Positive</th>
                      <th className="py-2">Positive rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.combos.map((c) => (
                      <tr key={`${c.sid}:${c.bid}`} className="border-b border-zinc-100">
                        <td className="py-2 pr-3 font-medium">
                          {c.slab} + {c.blab}
                        </td>
                        <td className="py-2 pr-3">{c.sent}</td>
                        <td className="py-2 pr-3">{c.repliedContacts}</td>
                        <td className="py-2 pr-3 font-semibold">{pct(c.replyRate)}</td>
                        <td className="py-2 pr-3">{c.positiveContacts}</td>
                        <td className="py-2">{pct(c.positiveRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          {res.combos.length > 0 && (
            <Card title="Combination matrix (replies / sends + rate)">
              <MatrixView combos={res.combos} comboByKey={comboByKey} />
            </Card>
          )}
          <p className="text-xs text-zinc-500">
            No open or click tracking is used. Rates use unique replied contacts; automatic /
            out-of-office messages are excluded from genuine reply rates. Sorted by reply rate —
            the top row is the current leader, not a statistically significant winner.
          </p>
        </div>
    );
  }
  return (
    <>
      <Nav active="/results" />
      <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
        <Card title="Experiment results">{body}</Card>
      </main>
    </>
  );
}

function MatrixView({
  combos,
  comboByKey,
}: {
  combos: { sid: number; slab: string; bid: number; blab: string; sent: number; repliedContacts: number; replyRate: number }[];
  comboByKey: Map<string, { sent: number; repliedContacts: number; replyRate: number }>;
}) {
  const sids = [...new Map(combos.map((c) => [c.sid, c.slab])).entries()].sort((a, b) => a[0] - b[0]);
  const bids = [...new Map(combos.map((c) => [c.bid, c.blab])).entries()].sort((a, b) => a[0] - b[0]);
  return (
    <div className="overflow-x-auto">
      <table className="text-center text-xs">
        <thead>
          <tr>
            <th className="px-2 py-1" />
            {bids.map(([id, label]) => (
              <th key={id} className="px-2 py-1 font-semibold text-zinc-600">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sids.map(([sid, slab]) => (
            <tr key={sid}>
              <th className="px-2 py-1 text-left font-semibold text-zinc-600">{slab}</th>
              {bids.map(([bid]) => {
                const c = comboByKey.get(`${sid}:${bid}`);
                return (
                  <td key={bid} className="border border-zinc-100 px-2 py-1">
                    {c ? (
                      <>
                        <div className="font-semibold">{c.repliedContacts} / {c.sent}</div>
                        <div className="text-zinc-500">{c.replyRate.toFixed(0)}%</div>
                      </>
                    ) : (
                      <span className="text-zinc-300">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
