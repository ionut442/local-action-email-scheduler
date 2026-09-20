import { UnsubscribeForm } from "@/components/unsubscribe-form";

export const dynamic = "force-dynamic";

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const sp = await searchParams;
  const token = (sp.token ?? "").trim();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <div className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-bold">Unsubscribe</h1>
        {!token ? (
          <p className="mt-2 text-sm text-red-700">
            This unsubscribe link is invalid (missing token).
          </p>
        ) : (
          <div className="mt-2">
            <UnsubscribeForm token={token} />
          </div>
        )}
      </div>
    </main>
  );
}
