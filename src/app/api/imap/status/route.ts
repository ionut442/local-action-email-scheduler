import { getImapStatus } from "@/lib/replies";
import { requireAdmin } from "@/lib/require-admin";

export const runtime = "nodejs";

/** IMAP/reply-sync status (never exposes credentials). */
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    return Response.json(await getImapStatus());
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Status unavailable." },
      { status: 500 }
    );
  }
}
