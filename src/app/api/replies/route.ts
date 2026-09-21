import { eq } from "drizzle-orm";
import { db, ensureSchema } from "@/db";
import { inboundReplies } from "@/db/schema";
import { syncReplies, type ReplyClassification } from "@/lib/replies";
import { requireAdmin } from "@/lib/require-admin";

const CLASSIFICATIONS: ReplyClassification[] = [
  "unclassified",
  "positive",
  "negative",
  "other",
  "automatic",
];

/** Manual "Sync replies now" — same logic as the cron. */
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  let days = 0;
  try {
    const body = (await req.json()) as { backfillDays?: number };
    if (Number.isFinite(body.backfillDays)) days = Math.floor(body.backfillDays as number);
  } catch {
    /* no body: plain sync */
  }
  try {
    const result = await syncReplies(days > 0 ? { backfillDays: days } : undefined);
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Reply sync failed." },
      { status: 500 }
    );
  }
}

/** Manual reply classification. */
export async function PUT(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  let id = 0;
  let classification = "";
  try {
    const body = (await req.json()) as { id?: number; classification?: string };
    id = Number(body.id);
    classification = String(body.classification ?? "");
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "Invalid reply id." }, { status: 400 });
  }
  if (!CLASSIFICATIONS.includes(classification as ReplyClassification)) {
    return Response.json(
      { error: `Classification must be one of: ${CLASSIFICATIONS.join(", ")}.` },
      { status: 400 }
    );
  }
  try {
    await ensureSchema();
    await db()
      .update(inboundReplies)
      .set({ classification })
      .where(eq(inboundReplies.id, id));
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Database update failed." }, { status: 500 });
  }
}
