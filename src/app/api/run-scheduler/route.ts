import { runScheduler } from "@/lib/scheduler";
import { requireAdmin } from "@/lib/require-admin";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Manual "Run scheduler now" — same logic as the cron, admin-authenticated. */
export async function POST() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
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
