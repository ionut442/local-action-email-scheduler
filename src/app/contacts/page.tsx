import Link from "next/link";
import { redirect } from "next/navigation";
import { and, count, desc, eq, ilike, inArray, not, or, sql } from "drizzle-orm";
import { db, ensureSchema } from "@/db";
import {
  contacts,
  emailBodyVariants,
  emailSubjectVariants,
  inboundReplies,
} from "@/db/schema";
import { isAdminAuthenticated } from "@/lib/auth";
import { Nav, Card, StatusBadge } from "@/components/ui";
import { CsvUploader, RetryOneButton, RetryAllButton } from "@/components/contacts";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const STATUSES = ["all", "pending", "processing", "sent", "failed", "unsubscribed"];

function fmt(d: Date | string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    page?: string;
    replied?: string;
    svar?: string;
    bvar?: string;
  }>;
}) {
  if (!(await isAdminAuthenticated())) redirect("/login");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const status = STATUSES.includes(sp.status ?? "") ? (sp.status as string) : "all";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const replied = ["all", "yes", "no"].includes(sp.replied ?? "") ? (sp.replied as string) : "all";
  const svar = Number(sp.svar) || 0;
  const bvar = Number(sp.bvar) || 0;

  let rows: typeof contacts.$inferSelect[] = [];
  let total = 0;
  let dbError: string | null = null;
  let subjectLabels: { id: number; label: string }[] = [];
  let bodyLabels: { id: number; label: string }[] = [];
  const variantLabel = new Map<number, string>();
  const repliedMap = new Map<number, Date | string>();

  try {
    await ensureSchema();
    const database = db();

    // Variant id → label maps (active campaign, for badges + filters).
    const { getActiveCampaign } = await import("@/lib/experiment");
    const active = await getActiveCampaign();
    if (active.campaign) {
      const [ss, bs] = await Promise.all([
        database.select().from(emailSubjectVariants),
        database.select().from(emailBodyVariants),
      ]);
      subjectLabels = ss
        .filter((v) => v.campaignId === active.campaign!.id)
        .map((v) => ({ id: v.id, label: v.label }));
      bodyLabels = bs
        .filter((v) => v.campaignId === active.campaign!.id)
        .map((v) => ({ id: v.id, label: v.label }));
      for (const v of [...ss, ...bs]) variantLabel.set(v.id, v.label);
    }

    const filters = [];
    if (status !== "all") filters.push(eq(contacts.status, status));
    if (svar) filters.push(eq(contacts.subjectVariantId, svar));
    if (bvar) filters.push(eq(contacts.bodyVariantId, bvar));
    if (replied !== "all") {
      const repliedIds = await database
        .selectDistinct({ id: inboundReplies.contactId })
        .from(inboundReplies);
      const ids = repliedIds.map((r) => r.id).filter((x): x is number => x != null);
      if (replied === "yes") {
        filters.push(ids.length > 0 ? inArray(contacts.id, ids) : sql`1 = 0`);
      } else {
        if (ids.length > 0) filters.push(not(inArray(contacts.id, ids)));
      }
    }
    if (q) {
      const like = `%${q}%`;
      filters.push(
        or(
          ilike(contacts.email, like),
          ilike(contacts.businessName, like),
          ilike(contacts.trade, like),
          ilike(contacts.city, like),
          ilike(contacts.country, like)
        )
      );
    }
    const where = filters.length > 0 ? and(...filters) : undefined;
    const totalRows = await database.select({ n: count() }).from(contacts).where(where);
    total = Number(totalRows[0]?.n ?? 0);
    rows = await database
      .select()
      .from(contacts)
      .where(where)
      .orderBy(desc(contacts.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE);

    // Replied indicator for the visible rows.
    const pageIds = rows.map((r) => r.id);
    if (pageIds.length > 0) {
      const reps = await database
        .select({ contactId: inboundReplies.contactId, receivedAt: inboundReplies.receivedAt })
        .from(inboundReplies)
        .where(inArray(inboundReplies.contactId, pageIds));
      for (const r of reps) {
        if (r.contactId == null || !r.receivedAt) continue;
        const prev = repliedMap.get(r.contactId);
        if (!prev || new Date(r.receivedAt) > new Date(prev)) {
          repliedMap.set(r.contactId, r.receivedAt);
        }
      }
    }
  } catch (err) {
    dbError = err instanceof Error ? err.message : "Database unavailable.";
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const link = (p: number) =>
    `/contacts?q=${encodeURIComponent(q)}&status=${status}&replied=${replied}&svar=${svar}&bvar=${bvar}&page=${p}`;

  return (
    <>
      <Nav active="/contacts" />
      <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
        <Card title="Import contacts">
          <CsvUploader />
          <p className="mt-2 text-xs text-zinc-500">
            Columns: business_name, trade, email (required), website, phone, google_maps_url,
            city, country. Duplicates, sent and unsubscribed addresses are never re-imported.
          </p>
        </Card>

        <Card title={`Contacts (${total})`}>
          <form method="get" className="mb-3 flex flex-wrap items-center gap-2">
            <input
              name="q"
              defaultValue={q}
              placeholder="Search business, email, city…"
              className="w-64 rounded-md border border-zinc-300 px-3 py-1.5 text-sm"
            />
            <select
              name="status"
              defaultValue={status}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              name="replied"
              defaultValue={replied}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm"
              title="Reply filter"
            >
              <option value="all">all replies</option>
              <option value="yes">replied</option>
              <option value="no">not replied</option>
            </select>
            <select
              name="svar"
              defaultValue={String(svar)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm"
              title="Subject variant filter"
            >
              <option value="0">all subjects</option>
              {subjectLabels.map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
            <select
              name="bvar"
              defaultValue={String(bvar)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm"
              title="Body variant filter"
            >
              <option value="0">all bodies</option>
              {bodyLabels.map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
            >
              Filter
            </button>
            <span className="ml-auto">
              <RetryAllButton />
            </span>
          </form>

          {dbError ? (
            <p className="text-sm text-red-700">{dbError}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-zinc-500">No contacts found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                    <th className="py-2 pr-3">Business</th>
                    <th className="py-2 pr-3">Trade</th>
                    <th className="py-2 pr-3">Email</th>
                    <th className="py-2 pr-3">City/Country</th>
                    <th className="py-2 pr-3">Variant</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Replied</th>
                    <th className="py-2 pr-3">Imported</th>
                    <th className="py-2 pr-3">Sent</th>
                    <th className="py-2 pr-3">Last error</th>
                    <th className="py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id} className="border-b border-zinc-100">
                      <td className="py-2 pr-3 font-medium">{c.businessName || "—"}</td>
                      <td className="py-2 pr-3 text-zinc-600">{c.trade || "—"}</td>
                      <td className="py-2 pr-3">{c.email}</td>
                      <td className="py-2 pr-3 text-zinc-600">
                        {[c.city, c.country].filter(Boolean).join(", ") || "—"}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {c.subjectVariantId != null && c.bodyVariantId != null ? (
                          <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-semibold">
                            {variantLabel.get(c.subjectVariantId) ?? `S${c.subjectVariantId}`} · {variantLabel.get(c.bodyVariantId) ?? `B${c.bodyVariantId}`}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <StatusBadge status={c.status ?? "pending"} />
                      </td>
                      <td className="py-2 pr-3 text-xs text-zinc-600">
                        {repliedMap.has(c.id) ? (
                          <span className="font-semibold text-green-700" title={fmt(repliedMap.get(c.id) ?? null)}>
                            ✓ {fmt(repliedMap.get(c.id) ?? null)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2 pr-3 text-zinc-600">{fmt(c.createdAt)}</td>
                      <td className="py-2 pr-3 text-zinc-600">{fmt(c.sentAt)}</td>
                      <td className="max-w-[220px] truncate py-2 pr-3 text-xs text-red-700" title={c.lastError ?? ""}>
                        {c.lastError ?? "—"}
                      </td>
                      <td className="py-2">{c.status === "failed" && <RetryOneButton id={c.id} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-3 flex items-center gap-2 text-sm">
            <Link
              href={link(Math.max(1, page - 1))}
              className={`rounded border px-2 py-1 ${page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-zinc-50"}`}
            >
              Prev
            </Link>
            <span className="text-zinc-600">
              Page {page} of {totalPages}
            </span>
            <Link
              href={link(Math.min(totalPages, page + 1))}
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
