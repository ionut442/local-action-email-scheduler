import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";

export async function requireAdmin(): Promise<
  { ok: true } | { ok: false; response: Response }
> {
  if (!process.env.ADMIN_PASSWORD || !process.env.AUTH_SECRET) {
    return {
      ok: false,
      response: Response.json(
        { error: "Server auth is not configured (ADMIN_PASSWORD / AUTH_SECRET)." },
        { status: 500 }
      ),
    };
  }
  const jar = await cookies();
  if (!verifySession(jar.get(SESSION_COOKIE)?.value)) {
    return {
      ok: false,
      response: Response.json({ error: "Unauthorized." }, { status: 401 }),
    };
  }
  return { ok: true };
}
