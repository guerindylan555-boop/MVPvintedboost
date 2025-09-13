import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public paths
  const isPublic =
    pathname === "/login" ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/studio") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/assets");

  if (isPublic) return NextResponse.next();

  // Check Better Auth session cookie presence. We don't parse it; we just gate by presence to avoid extra calls.
  const cookieHeader = req.headers.get("cookie") || "";
  const hasSession = /better-auth\.session_token=/.test(cookieHeader);
  if (!hasSession) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};