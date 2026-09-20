import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/auth";
import { getDashboardStats } from "@/lib/scheduler";
import { Nav, Card, StatusBadge } from "@/components/ui";
import { RunSchedulerButton, SendingToggle } from "@/components/actions";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  if (!(await isAdminAuthenticated())) redirect("/login");

  let stats;
  try {
    stats = await getDashboardStats();
  } catch (err) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Card title="Database error">
          <p className="text-sm text-red-700">
            Could not load dashboard: {err instanceof Error ? err.message : "unknown error"}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            Check that DATABASE_URL is set and migrations have been applied (`npm run db:migrate`).
          </p>
        </Card>
      </main>
    );
  }

  const s = stats.settings;
  const tiles = [
    { label: "Pending", value: stats.pending },
    { label: "Sent today", value: stats.sentToday },
    { label: "Sent total (contacts)", value: stats.sent },
    { label: "Failed", value: stats.failed },
    { label: "Unsubscribed", value: stats.unsubscribed },
  ];

  return (
    <>
      <Nav active="/" sendingEnabled={s?.sendingEnabled ?? false} />
      <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="text-2xl font-bold">{t.value}</div>
              <div className="text-xs uppercase tracking-wide text-zinc-500">{t.label}</div>
            </div>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Sending control">
            <div className="flex items-center gap-3">
              <SendingToggle
                initial={s?.sendingEnabled ?? false}
                dailyLimit={s?.dailyLimit ?? 30}
                subject={s?.subject ?? ""}
                body={s?.body ?? ""}
                senderName={s?.senderName ?? "LocalAction"}
              />
              <span className="text-sm font-medium">
                Email sending {(s?.sendingEnabled ?? false) ? "ON" : "OFF"}
              </span>
            </div>
            <dl className="mt-3 space-y-1 text-sm">
              <div className="flex gap-2">
                <dt className="w-28 text-zinc-500">Daily limit</dt>
                <dd className="font-medium">{s?.dailyLimit ?? 30}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 text-zinc-500">Subject</dt>
                <dd className="truncate font-medium">{s?.subject || "(not set)"}</dd>
              </div>
            </dl>
            <div className="mt-4">
              <RunSchedulerButton />
            </div>
          </Card>

          <Card title="Recent activity">
            {stats.recent.length === 0 ? (
              <p className="text-sm text-zinc-500">No emails sent yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {stats.recent.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{l.recipient}</span>
                    <StatusBadge status={l.status ?? ""} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </main>
    </>
  );
}
