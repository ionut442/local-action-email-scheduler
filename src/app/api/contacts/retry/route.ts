import { and, eq } from "drizzle-orm";
import { db, ensureSchema } from "@/db";
import { contacts } from "@/db/schema";
import { requireAdmin } from "@/lib/require-admin";

/**
 * Move FAILED contacts back to pending for retry.
 * Sent / unsubscribed / pending contacts are never touched, so a sent
 * contact can never be accidentally resent through this endpoint.
 */
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let ids: number[] = [];
  let allFailed = false;
  try {
    const body = (await req.json()) as { ids?: number[]; allFailed?: boolean };
    if (Array.isArray(body.ids)) ids = body.ids.filter((n) => Number.isInteger(n));
    allFailed = body.allFailed === true;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    await ensureSchema();
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Database unavailable." },
      { status: 500 }
    );
  }
  const database = db();

  try {
    if (allFailed) {
      await database
        .update(contacts)
        .set({ status: "pending", lastError: null, updatedAt: new Date() })
        .where(eq(contacts.status, "failed"));
      return Response.json({ ok: true });
    }
    if (ids.length === 0 || ids.length > 500) {
      return Response.json(
        { error: "Provide 1–500 contact ids, or use allFailed." },
        { status: 400 }
      );
    }
    let updated = 0;
    for (const id of ids) {
      // WHERE status='failed' guarantees sent contacts are never reset.
       
      await database
        .update(contacts)
        .set({ status: "pending", lastError: null, updatedAt: new Date() })
        .where(and(eq(contacts.id, id), eq(contacts.status, "failed")));
      updated += 1;
    }
    return Response.json({ ok: true, requested: updated });
  } catch {
    return Response.json({ error: "Database update failed." }, { status: 500 });
  }
}
