import Link from "next/link";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/contacts", label: "Contacts" },
  { href: "/email", label: "Email" },
  { href: "/activity", label: "Activity" },
  { href: "/settings", label: "Settings" },
];

export function Nav({
  active,
  sendingEnabled,
}: {
  active: string;
  sendingEnabled?: boolean;
}) {
  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-3">
        <span className="mr-4 text-sm font-bold tracking-tight">
          LocalAction <span className="font-normal text-zinc-500">· Email Scheduler</span>
        </span>
        <nav className="flex flex-wrap items-center gap-1">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-md px-3 py-1.5 text-sm ${
                active === l.href
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-600 hover:bg-zinc-100"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {typeof sendingEnabled === "boolean" && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                sendingEnabled
                  ? "bg-green-100 text-green-800"
                  : "bg-zinc-200 text-zinc-700"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${sendingEnabled ? "bg-green-600" : "bg-zinc-500"}`}
              />
              Sending {sendingEnabled ? "ON" : "OFF"}
            </span>
          )}
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50"
            >
              Log out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}

export function Card({
  title,
  children,
  wide,
}: {
  title?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <section
      className={`rounded-lg border border-zinc-200 bg-white p-4 shadow-sm ${wide ? "" : ""}`}
    >
      {title && (
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-amber-100 text-amber-800",
    processing: "bg-blue-100 text-blue-800",
    sent: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-800",
    unsubscribed: "bg-zinc-200 text-zinc-700",
  };
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${colors[status] ?? "bg-zinc-100 text-zinc-600"}`}
    >
      {status}
    </span>
  );
}
