import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "la_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function getAuthSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

function b64urlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function b64urlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

export function signSession(expirySeconds = SESSION_MAX_AGE): string {
  const payload = JSON.stringify({
    v: 1,
    exp: Math.floor(Date.now() / 1000) + expirySeconds,
    n: randomBytes(8).toString("hex"),
  });
  const body = b64urlEncode(payload);
  const sig = createHmac("sha256", getAuthSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySession(token: string | undefined | null): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [body, sig] = parts;
  let expected: string;
  try {
    expected = createHmac("sha256", getAuthSecret()).update(body).digest("base64url");
  } catch {
    return false;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    if (!timingSafeEqual(a, b)) return false;
  } catch {
    return false;
  }
  try {
    const payload = JSON.parse(b64urlDecode(body)) as { exp?: number };
    if (typeof payload.exp !== "number") return false;
    return payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

/** Constant-time admin password comparison (length-normalized via sha256). */
export function verifyAdminPassword(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD ?? "";
  if (!expected || !input) return false;
  const hash = (s: string) =>
    createHmac("sha256", "admin-password-compare").update(s).digest();
  const a = hash(input);
  const b = hash(expected);
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function createSessionCookie() {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, signSession(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function destroySessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function isAdminAuthenticated(): Promise<boolean> {
  try {
    const jar = await cookies();
    return verifySession(jar.get(SESSION_COOKIE)?.value);
  } catch {
    return false;
  }
}
