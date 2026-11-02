import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Route guard for the portal (Next 16 `proxy` convention, formerly `middleware`).
 *
 * This only checks that a token cookie exists and has not expired. It does NOT
 * verify the signature — that happens in the API authorizer, which is the real
 * security boundary. The proxy exists so an unauthenticated visitor sees a login
 * page instead of a shell that immediately fails.
 */

const AUTH_COOKIE = "tw_admin_id_token";

function hasValidCookie(request: NextRequest): boolean {
  const token = request.cookies.get(AUTH_COOKIE)?.value;
  if (!token) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
    return typeof payload.exp === "number" && payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

export default function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const authed = hasValidCookie(request);

  if (pathname === "/preview") return NextResponse.next();

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
