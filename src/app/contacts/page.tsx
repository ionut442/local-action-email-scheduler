import Link from "next/link";
import { redirect } from "next/navigation";
import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import { db, ensureSchema } from "@/db";
import { contacts } from "@/db/schema";
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
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  if (!(await isAdminAuthenticated())) redirect("/login");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const status = STATUSES.includes(sp.status ?? "") ? (sp.status as string) : "all";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  let rows: typeof contacts.$inferSelect[] = [];
  let total = 0;
  let dbError: string | null = null;
  try {
    await ensureSchema();
    const database = db();
    const filters = [];
    if (status !== "all") filters.push(eq(contacts.status, status));
    if (q) {
      const like = `%${q}%`;
      filters.push(
        or(
          ilike(contacts.email, like),
          ilike(contacts.businessName, like),
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
  } catch (err) {
    dbError = err instanceof Error ? err.message : "Database unavailable.";
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const link = (p: number) =>
    `/contacts?q=${encodeURIComponent(q)}&status=${status}&page=${p}`;

  return (
    <>
      <Nav active="/contacts" />
      <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
        <Card title="Import contacts">
          <CsvUploader />
          <p className="mt-2 text-xs text-zinc-500">
            Columns: business_name, email (required), website, phone, google_maps_url, city,
            country. Duplicates, sent and unsubscribed addresses are never re-imported.
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
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                    <th className="py-2 pr-3">Business</th>
                    <th className="py-2 pr-3">Email</th>
                    <th className="py-2 pr-3">City/Country</th>
                    <th className="py-2 pr-3">Status</th>
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
                      <td className="py-2 pr-3">{c.email}</td>
                      <td className="py-2 pr-3 text-zinc-600">
                        {[c.city, c.country].filter(Boolean).join(", ") || "—"}
                      </td>
                      <td className="py-2 pr-3">
                        <StatusBadge status={c.status ?? "pending"} />
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
