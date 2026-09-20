import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PREFIXES = ["/login", "/unsubscribe", "/api/auth/", "/api/cron/"];

// Optimistic check only: the presence of a session cookie. Full signature
// verification happens server-side in pages and API routes.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    PUBLIC_PREFIXES.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(p)
    )
  ) {
    return NextResponse.next();
  }
  // Allow Next internals and static assets.
  if (pathname.startsWith("/_next") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }
  const hasSession = Boolean(request.cookies.get("la_session")?.value);
  if (!hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
