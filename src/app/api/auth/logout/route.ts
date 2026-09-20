import { NextResponse } from "next/server";
import { destroySessionCookie } from "@/lib/auth";

export async function POST(req: Request) {
  await destroySessionCookie();
  const accepts = req.headers.get("accept") ?? "";
  if (accepts.includes("application/json")) {
    return NextResponse.json({ ok: true });
  }
  return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
}

export async function GET(req: Request) {
  await destroySessionCookie();
  return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
}
