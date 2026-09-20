import { NextResponse } from "next/server";
import { createSessionCookie, verifyAdminPassword } from "@/lib/auth";

export async function POST(req: Request) {
  let password = "";
  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as { password?: string };
      password = String(body.password ?? "");
    } else {
      const form = await req.formData();
      password = String(form.get("password") ?? "");
    }
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!process.env.ADMIN_PASSWORD) {
    return NextResponse.json(
      { error: "ADMIN_PASSWORD is not configured on the server." },
      { status: 500 }
    );
  }
  if (!process.env.AUTH_SECRET) {
    return NextResponse.json(
      { error: "AUTH_SECRET is not configured on the server." },
      { status: 500 }
    );
  }
  if (!verifyAdminPassword(password)) {
    // Generic message to avoid user enumeration (there is only one admin anyway).
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  await createSessionCookie();

  // HTML form posts expect a redirect; API callers expect JSON.
  const accepts = req.headers.get("accept") ?? "";
  if (accepts.includes("application/json")) {
    return NextResponse.json({ ok: true });
  }
  return NextResponse.redirect(new URL("/", req.url), { status: 303 });
}
