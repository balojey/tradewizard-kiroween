import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Route guard for the portal (Next 16 `proxy` convention, formerly `middleware`).
 *
 * It checks for the presence of the session marker cookie only — no token, no
 * signature, no expiration logic. The marker exists so an unauthenticated
 * visitor sees the login page instead of a shell that immediately fails; the
 * API authorizer is the real security boundary, and the client refreshes its
 * short-lived ID token behind this marker.
 */

const SESSION_COOKIE = "tw_admin_session";

export default function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const authed = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === "/login") {
    if (authed) {
      return NextResponse.redirect(new URL("/overview", request.url), 307);
    }
    return NextResponse.next();
  }

  if (!authed) {
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/") loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl, 307);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
