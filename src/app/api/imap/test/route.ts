import { testImapConnection } from "@/lib/imap";
import { requireAdmin } from "@/lib/require-admin";

export const runtime = "nodejs";

/** Verify IMAP connectivity without importing anything. */
export async function POST() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const result = await testImapConnection();
    return Response.json(result, { status: result.ok ? 200 : 502 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "IMAP test failed." },
      { status: 500 }
    );
  }
}
