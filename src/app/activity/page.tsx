import Link from "next/link";
import { redirect } from "next/navigation";
import { count, desc, eq, inArray } from "drizzle-orm";
import { db, ensureSchema } from "@/db";
import { emailCampaigns, emailLogs, inboundReplies } from "@/db/schema";
import { isAdminAuthenticated } from "@/lib/auth";
import { Nav, Card, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

function fmt(d: Date | string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  if (!(await isAdminAuthenticated())) redirect("/login");
  const sp = await searchParams;
  const status = sp.status === "sent" || sp.status === "failed" ? sp.status : "all";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  let rows: typeof emailLogs.$inferSelect[] = [];
  let total = 0;
  let dbError: string | null = null;
  const campaignNames = new Map<number, string>();
  // logId -> 'replied' | 'auto'
  const replyState = new Map<number, "replied" | "auto">();
  try {
    await ensureSchema();
    const database = db();
    const where = status === "all" ? undefined : eq(emailLogs.status, status);
    const totalRows = await database.select({ n: count() }).from(emailLogs).where(where);
    total = Number(totalRows[0]?.n ?? 0);
    rows = await database
      .select()
      .from(emailLogs)
      .where(where)
      .orderBy(desc(emailLogs.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE);
    const camps = await database.select().from(emailCampaigns);
    for (const c of camps) campaignNames.set(c.id, c.name || `Campaign ${c.id}`);
    const logIds = rows.map((r) => r.id);
    if (logIds.length > 0) {
      const reps = await database
        .select({ logId: inboundReplies.emailLogId, classification: inboundReplies.classification })
        .from(inboundReplies)
        .where(inArray(inboundReplies.emailLogId, logIds));
      for (const r of reps) {
        if (r.logId == null) continue;
        const cur = replyState.get(r.logId);
        if (r.classification !== "automatic") replyState.set(r.logId, "replied");
        else if (!cur) replyState.set(r.logId, "auto");
      }
    }
  } catch (err) {
    dbError = err instanceof Error ? err.message : "Database unavailable.";
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <Nav active="/activity" />
      <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
        <Card title={`Send logs (${total})`}>
          <div className="mb-3 flex gap-2 text-sm">
            {["all", "sent", "failed"].map((s) => (
              <Link
                key={s}
                href={`/activity?status=${s}`}
                className={`rounded-md px-3 py-1.5 ${status === s ? "bg-zinc-900 text-white" : "border border-zinc-300 hover:bg-zinc-50"}`}
              >
                {s}
              </Link>
            ))}
          </div>
          {dbError ? (
            <p className="text-sm text-red-700">{dbError}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-zinc-500">No log entries yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                    <th className="py-2 pr-3">Date/time</th>
                    <th className="py-2 pr-3">Recipient</th>
                    <th className="py-2 pr-3">Subject</th>
                    <th className="py-2 pr-3">Campaign</th>
                    <th className="py-2 pr-3">Variant</th>
                    <th className="py-2 pr-3">Reply</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l) => (
                    <tr key={l.id} className="border-b border-zinc-100">
                      <td className="py-2 pr-3 text-zinc-600">{fmt(l.createdAt)}</td>
                      <td className="py-2 pr-3">{l.recipient}</td>
                      <td className="max-w-[220px] truncate py-2 pr-3" title={l.subjectSnapshot ?? ""}>
                        {l.subjectSnapshot}
                      </td>
                      <td className="py-2 pr-3 text-xs text-zinc-600">
                        {l.campaignId != null ? (campaignNames.get(l.campaignId) ?? `Campaign ${l.campaignId}`) : "—"}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {l.subjectVariantLabel && l.bodyVariantLabel ? (
                          <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-semibold">
                            {l.subjectVariantLabel} · {l.bodyVariantLabel}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {replyState.get(l.id) === "replied" ? (
                          <span className="font-semibold text-green-700">Replied</span>
                        ) : replyState.get(l.id) === "auto" ? (
                          <span className="text-zinc-500">Auto</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <StatusBadge status={l.status ?? ""} />
                      </td>
                      <td className="max-w-[220px] truncate py-2 text-xs text-red-700" title={l.error ?? ""}>
                        {l.error ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-3 flex items-center gap-2 text-sm">
            <Link
              href={`/activity?status=${status}&page=${Math.max(1, page - 1)}`}
              className={`rounded border px-2 py-1 ${page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-zinc-50"}`}
            >
              Prev
            </Link>
            <span className="text-zinc-600">
              Page {page} of {totalPages}
            </span>
            <Link
              href={`/activity?status=${status}&page=${Math.min(totalPages, page + 1)}`}
              className={`rounded border px-2 py-1 ${page >= totalPages ? "pointer-events-none opacity-40" : "hover:bg-zinc-50"}`}
            >
              Next
            </Link>
          </div>
        </Card>
      </main>
    </>
  );
}
