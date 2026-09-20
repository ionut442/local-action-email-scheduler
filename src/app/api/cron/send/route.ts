import { runScheduler } from "@/lib/scheduler";

export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorized(req: Request): boolean {
  const expected = process.env.CRON_SECRET ?? "";
  if (!expected) return false;
  const url = new URL(req.url);
  const candidates = [
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "",
    req.headers.get("x-cron-secret") ?? "",
    url.searchParams.get("secret") ?? "",
  ];
  return candidates.some((c) => c !== "" && c === expected);
}

/** Vercel Cron entrypoint (once daily). Frequency-independent: safe at any cadence. */
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) {
    return Response.json(
      { error: "CRON_SECRET is not configured on the server." },
      { status: 500 }
    );
  }
  if (!isAuthorized(req)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const result = await runScheduler();
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Scheduler failed." },
      { status: 500 }
    );
  }
}
