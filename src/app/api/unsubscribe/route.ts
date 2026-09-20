import { eq } from "drizzle-orm";
import { db, ensureSchema } from "@/db";
import { contacts } from "@/db/schema";

export async function POST(req: Request) {
  let token = "";
  try {
    const body = (await req.json()) as { token?: string };
    token = String(body.token ?? "").trim();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!token || token.length > 256) {
    return Response.json({ error: "Missing token." }, { status: 400 });
  }
  try {
    await ensureSchema();
    const database = db();
    const rows = await database
      .select({ id: contacts.id, status: contacts.status })
      .from(contacts)
      .where(eq(contacts.unsubscribeToken, token))
      .limit(1);
    if (rows.length === 0) {
      return Response.json({ error: "Unknown unsubscribe link." }, { status: 404 });
    }
    await database
      .update(contacts)
      .set({ status: "unsubscribed", updatedAt: new Date() })
      .where(eq(contacts.id, rows[0].id));
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Database unavailable." }, { status: 500 });
  }
}
