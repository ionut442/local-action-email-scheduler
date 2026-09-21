import Link from "next/link";
import { redirect } from "next/navigation";
import { and, count, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { db, ensureSchema } from "@/db";
import {
  contacts,
  emailBodyVariants,
  emailCampaigns,
  emailLogs,
  emailSubjectVariants,
  inboundReplies,
} from "@/db/schema";
import { isAdminAuthenticated } from "@/lib/auth";
import { Nav, Card, StatusBadge } from "@/components/ui";
import { ClassifyButtons, SyncRepliesButton } from "@/components/replies";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const CLASSIFICATIONS = ["all", "unclassified", "positive", "negative", "other", "automatic"];

function fmt(d: Date | string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

export default async function RepliesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    classification?: string;
    campaign?: string;
    svar?: string;
    bvar?: string;
    page?: string;
    id?: string;
  }>;
}) {
  if (!(await isAdminAuthenticated())) redirect("/login");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const classification = CLASSIFICATIONS.includes(sp.classification ?? "")
    ? (sp.classification as string)
    : "all";
  const campaignId = Number(sp.campaign) || 0;
  const svar = Number(sp.svar) || 0;
  const bvar = Number(sp.bvar) || 0;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const detailId = Number(sp.id) || 0;

  let rows: typeof inboundReplies.$inferSelect[] = [];
  let total = 0;
  let dbError: string | null = null;
  let campaigns: typeof emailCampaigns.$inferSelect[] = [];
  let subjectVariants: typeof emailSubjectVariants.$inferSelect[] = [];
  let bodyVariants: typeof emailBodyVariants.$inferSelect[] = [];
  let imapConfigured: boolean | null = null;
  const logMap = new Map<number, typeof emailLogs.$inferSelect>();
  const contactMap = new Map<number, typeof contacts.$inferSelect>();

  try {
    await ensureSchema();
    const database = db();
    const { getImapConfig } = await import("@/lib/imap");
    imapConfigured = getImapConfig() !== null;
    campaigns = await database.select().from(emailCampaigns);
    const campFilter = campaignId || campaigns.find((c) => c.active)?.id || 0;
    if (campFilter) {
      subjectVariants = await database
        .select()
        .from(emailSubjectVariants)
        .where(eq(emailSubjectVariants.campaignId, campFilter));
      bodyVariants = await database
        .select()
        .from(emailBodyVariants)
        .where(eq(emailBodyVariants.campaignId, campFilter));
    }

    const filters = [];
    if (classification !== "all") filters.push(eq(inboundReplies.classification, classification));
    if (campFilter) filters.push(eq(inboundReplies.campaignId, campFilter));
    if (q) {
      const like = `%${q}%`;
      filters.push(
        or(
          ilike(inboundReplies.fromEmail, like),
          ilike(inboundReplies.subject, like),
          ilike(inboundReplies.snippet, like)
        )
      );
    }
    const where = filters.length > 0 ? and(...filters) : undefined;
    const totalRows = await database
      .select({ n: count() })
      .from(inboundReplies)
      .where(where);
    total = Number(totalRows[0]?.n ?? 0);
    let fetched = await database
      .select()
      .from(inboundReplies)
      .where(where)
      .orderBy(desc(inboundReplies.receivedAt))
      .limit(200)
      .offset((page - 1) * PAGE_SIZE);

    // Variant filters apply to the linked outbound email (enriched below).
    // Enrich with logs + contacts.
    const logIds = [...new Set(fetched.map((r) => r.emailLogId).filter((x): x is number => x != null))];
    if (logIds.length > 0) {
      const logs = await database
        .select()
        .from(emailLogs)
        .where(inArray(emailLogs.id, logIds));
      for (const l of logs) logMap.set(l.id, l);
    }
    if (svar || bvar) {
      fetched = fetched.filter((r) => {
        if (r.emailLogId == null) return false;
        const l = logMap.get(r.emailLogId);
        if (!l) return false;
        if (svar && l.subjectVariantId !== svar) return false;
        if (bvar && l.bodyVariantId !== bvar) return false;
        return true;
      });
    }
    const contactIds = [
      ...new Set(
        [...fetched.map((r) => r.contactId), ...[...logMap.values()].map((l) => l.contactId)]
          .filter((x): x is number => x != null)
      ),
    ];
    if (contactIds.length > 0) {
      const people = await database
        .select()
        .from(contacts)
        .where(inArray(contacts.id, contactIds));
      for (const p of people) contactMap.set(p.id, p);
    }
    rows = fetched.slice(0, PAGE_SIZE);
  } catch (err) {
    dbError = err instanceof Error ? err.message : "Database unavailable.";
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const baseLink = (extra: string) =>
    `/replies?q=${encodeURIComponent(q)}&classification=${classification}&campaign=${campaignId}&svar=${svar}&bvar=${bvar}${extra}`;
  const detail = detailId ? rows.find((r) => r.id === detailId) : null;

  return (
    <>
      <Nav active="/replies" />
      <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
        {imapConfigured === false && (
          <Card title="Reply tracking">
            <p className="text-sm text-amber-800">
              IMAP is <strong>not configured</strong> — sending works normally, but no replies
              will be detected. Set IMAP_HOST, IMAP_PORT, IMAP_SECURE, IMAP_USER and
              IMAP_PASSWORD in Vercel environment variables, then use “Sync replies now”.
            </p>
          </Card>
        )}
        <Card title={`Replies (${total})`}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SyncRepliesButton label="Sync replies now" />
          </div>
          <form method="get" className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <input
              name="q"
              defaultValue={q}
              placeholder="Search sender, subject…"
              className="w-56 rounded-md border border-zinc-300 px-3 py-1.5"
            />
            <select name="classification" defaultValue={classification} className="rounded-md border border-zinc-300 px-2 py-1.5">
              {CLASSIFICATIONS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select name="campaign" defaultValue={String(campaignId)} className="rounded-md border border-zinc-300 px-2 py-1.5">
              <option value="0">All campaigns</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name || `Campaign ${c.id}`}</option>
              ))}
            </select>
            <select name="svar" defaultValue={String(svar)} className="rounded-md border border-zinc-300 px-2 py-1.5">
              <option value="0">All subjects</option>
              {subjectVariants.map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
            <select name="bvar" defaultValue={String(bvar)} className="rounded-md border border-zinc-300 px-2 py-1.5">
              <option value="0">All bodies</option>
              {bodyVariants.map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
            <button type="submit" className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-50">
              Filter
            </button>
          </form>

          {dbError ? (
            <p className="text-sm text-red-700">{dbError}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-zinc-500">No replies yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                    <th className="py-2 pr-3">Received</th>
                    <th className="py-2 pr-3">Business / Sender</th>
                    <th className="py-2 pr-3">Subject</th>
                    <th className="py-2 pr-3">Variant</th>
                    <th className="py-2 pr-3">Match</th>
                    <th className="py-2 pr-3">Classification</th>
                    <th className="py-2">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const log = r.emailLogId != null ? logMap.get(r.emailLogId) : undefined;
                    const person =
                      (r.contactId != null ? contactMap.get(r.contactId) : undefined) ??
                      (log?.contactId != null ? contactMap.get(log.contactId) : undefined);
                    return (
                      <tr key={r.id} className="border-b border-zinc-100">
                        <td className="py-2 pr-3 text-zinc-600">{fmt(r.receivedAt)}</td>
                        <td className="py-2 pr-3">
                          <div className="font-medium">{person?.businessName || "—"}</div>
                          <div className="text-xs text-zinc-500">
                            {r.fromEmail}
                            {person?.trade ? ` · ${person.trade}` : ""}
                          </div>
                        </td>
                        <td className="max-w-[220px] truncate py-2 pr-3" title={`${r.subject}\n\n${r.snippet}`}>
                          {r.subject || "(no subject)"}
                        </td>
                        <td className="py-2 pr-3 text-xs">
                          {log?.subjectVariantLabel && log?.bodyVariantLabel ? (
                            <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-semibold">
                              {log.subjectVariantLabel} · {log.bodyVariantLabel}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2 pr-3 text-xs text-zinc-500">{r.matchMethod}</td>
                        <td className="py-2 pr-3">
                          <StatusBadge status={r.classification ?? "unclassified"} />
                        </td>
                        <td className="py-2">
                          <Link href={baseLink(`&page=${page}&id=${r.id}`)} className="text-xs underline">
                            Open
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-3 flex items-center gap-2 text-sm">
            <Link href={baseLink(`&page=${Math.max(1, page - 1)}`)} className={`rounded border px-2 py-1 ${page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-zinc-50"}`}>
              Prev
            </Link>
            <span className="text-zinc-600">Page {page} of {totalPages}</span>
            <Link href={baseLink(`&page=${Math.min(totalPages, page + 1)}`)} className={`rounded border px-2 py-1 ${page >= totalPages ? "pointer-events-none opacity-40" : "hover:bg-zinc-50"}`}>
              Next
            </Link>
          </div>
        </Card>

        {detail && (
          <ReplyDetail
            reply={detail}
            log={detail.emailLogId != null ? logMap.get(detail.emailLogId) : undefined}
            person={
              (detail.contactId != null ? contactMap.get(detail.contactId) : undefined) ??
              undefined
            }
          />
        )}
      </main>
    </>
  );
}

function ReplyDetail({
  reply,
  log,
  person,
}: {
  reply: typeof inboundReplies.$inferSelect;
  log?: typeof emailLogs.$inferSelect;
  person?: typeof contacts.$inferSelect;
}) {
  return (
    <Card title={`Reply #${reply.id}`}>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="text-zinc-500">From</dt><dd className="font-medium">{reply.fromEmail}</dd></div>
        <div><dt className="text-zinc-500">Received</dt><dd>{fmt(reply.receivedAt)}</dd></div>
        <div><dt className="text-zinc-500">Business</dt><dd>{person?.businessName ?? "—"}{person?.trade ? ` (${person.trade})` : ""}</dd></div>
        <div><dt className="text-zinc-500">Match method</dt><dd>{reply.matchMethod}</dd></div>
        <div className="sm:col-span-2"><dt className="text-zinc-500">Incoming subject</dt><dd>{reply.subject || "(no subject)"}</dd></div>
        <div className="sm:col-span-2"><dt className="text-zinc-500">Snippet (plain text)</dt><dd className="rounded bg-zinc-50 p-2 text-xs">{reply.snippet || "—"}</dd></div>
        {log && (
          <>
            <div><dt className="text-zinc-500">Original sent</dt><dd>{fmt(log.sentAt)}</dd></div>
            <div><dt className="text-zinc-500">Variant</dt><dd>{log.subjectVariantLabel ?? "—"} · {log.bodyVariantLabel ?? "—"}</dd></div>
            <div className="sm:col-span-2"><dt className="text-zinc-500">Original subject</dt><dd className="font-medium">{log.subjectSnapshot}</dd></div>
            <div className="sm:col-span-2"><dt className="text-zinc-500">Original body (as sent)</dt><dd className="max-h-64 overflow-auto rounded bg-zinc-50 p-2 text-xs">{log.bodySnapshot}</dd></div>
          </>
        )}
        <div className="sm:col-span-2">
          <dt className="mb-1 text-zinc-500">Classification</dt>
          <dd><ClassifyButtons id={reply.id} current={reply.classification ?? "unclassified"} /></dd>
        </div>
      </dl>
    </Card>
  );
}
