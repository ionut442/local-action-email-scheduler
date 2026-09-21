import { syncReplies } from "@/lib/replies";

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

/** Polling reply sync (short-lived IMAP connection, cursor-based). */
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
    const result = await syncReplies();
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Reply sync failed." },
      { status: 500 }
    );
  }
}
