import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/auth";

export default async function LoginPage() {
  if (await isAdminAuthenticated()) redirect("/");
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <div className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-bold">LocalAction Email Scheduler</h1>
        <p className="mt-1 text-sm text-zinc-500">Private admin tool. Please log in.</p>
        <form action="/api/auth/login" method="post" className="mt-4 space-y-3">
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium">
              Admin password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-700"
          >
            Log in
          </button>
        </form>
      </div>
    </main>
  );
}
