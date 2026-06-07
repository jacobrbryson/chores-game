import { NextRequest, NextResponse } from "next/server";

// Pages that are accessible without signing in. Everything else redirects to /.
const PUBLIC_PATHS: string[] = ["/", "/privacy-policy", "/terms-of-service", "/change-log"];

function isPublicPath(pathname: string): boolean {
  for (const pub of PUBLIC_PATHS) {
    if (pathname === pub || pathname.startsWith(pub + "/")) return true;
  }
  return false;
}

function normalizeOrigin(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function getAllowedOrigins() {
  const configured = (process.env.MOBILE_WEB_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => normalizeOrigin(value))
    .filter(Boolean);

  const defaults = [
    "http://localhost:8081",
    "http://127.0.0.1:8081",
  ];

  return Array.from(new Set([...defaults, ...configured]));
}

function applyCorsHeaders(response: NextResponse, request: NextRequest) {
  const origin = normalizeOrigin(request.headers.get("origin") ?? "");
  if (!origin) {
    return response;
  }

  if (!getAllowedOrigins().includes(origin)) {
    return response;
  }

  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Allow-Credentials", "true");
  response.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.headers.append("Vary", "Origin");
  return response;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (request.method === "OPTIONS") {
    return applyCorsHeaders(new NextResponse(null, { status: 204 }), request);
  }

  // Auth guard: redirect unauthenticated users to home on all protected page routes.
  // API routes handle their own auth; the cookie presence check here is a UX gate only —
  // actual token validation happens in each server route via parseSessionToken.
  if (!pathname.startsWith("/api/") && !isPublicPath(pathname)) {
    if (!request.cookies.has("session_user")) {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  return applyCorsHeaders(NextResponse.next(), request);
}

export const config = {
  matcher: [
    // CORS routes
    "/api/v1/:path*",
    "/api/auth/google/mobile",
    "/api/auth/logout",
    // All page routes — excludes Next.js internals and static assets
    "/((?!_next/static|_next/image|favicon|icons|avatars|.*\\..*).*)",
  ],
};
