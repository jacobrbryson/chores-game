import { NextRequest, NextResponse } from "next/server";

// Pages that are accessible without signing in. Everything else redirects to /.
// /chores and /routines are session-aware: signed-out visitors get public SEO
// marketing pages there (the prefix match also covers /chores/ideas/* and the
// /chores/[slug] public content pages).
const PUBLIC_PATHS: string[] = [
  "/",
  "/privacy-policy",
  "/terms-of-service",
  "/change-log",
  "/chores",
  "/routines",
  "/pillars-of-responsibility",
];

function isPublicPath(pathname: string): boolean {
  for (const pub of PUBLIC_PATHS) {
    if (pathname === pub || pathname.startsWith(pub + "/")) return true;
  }
  return false;
}

// Edge-safe decode of the signed session cookie payload. We do NOT verify the
// HMAC here (that needs node:crypto, unavailable on the edge runtime) — this is
// only a UX redirect gate. The cookie is HttpOnly/signed and server routes
// remain the real authority, so reading the kiosk flag here is safe: a tampered
// flag can at most lock the user to /kiosk or drop them onto the player
// dashboard (already player-only).
export function readKioskActiveFromCookie(token: string | undefined): boolean {
  if (!token) {
    return false;
  }
  const segment = token.split(".")[0];
  if (!segment) {
    return false;
  }
  try {
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as {
      exp?: number;
      kioskActive?: boolean;
    };
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return false;
    }
    return payload.kioskActive === true;
  } catch {
    return false;
  }
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

function isAllowedMobileWebOrigin(origin: string, request: NextRequest) {
  if (getAllowedOrigins().includes(origin)) {
    return true;
  }

  if (process.env.NODE_ENV === "production") {
    return false;
  }

  try {
    const originUrl = new URL(origin);
    return (
      originUrl.protocol === request.nextUrl.protocol &&
      originUrl.hostname === request.nextUrl.hostname &&
      ["8081", "19006"].includes(originUrl.port)
    );
  } catch {
    return false;
  }
}

function applyCorsHeaders(response: NextResponse, request: NextRequest) {
  const origin = normalizeOrigin(request.headers.get("origin") ?? "");
  if (!origin) {
    return response;
  }

  if (!isAllowedMobileWebOrigin(origin, request)) {
    return response;
  }

  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Allow-Credentials", "true");
  response.headers.set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.headers.append("Vary", "Origin");
  return response;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (request.method === "OPTIONS") {
    return applyCorsHeaders(new NextResponse(null, { status: 204 }), request);
  }

  // Kiosk lock: while a session is in Kiosk Mode, the shared tablet is pinned to
  // /kiosk. Every other page route redirects there so the dashboard and the rest
  // of the app are never reachable until the PIN-gated exit clears the flag.
  // API routes are skipped (the kiosk page needs them); /kiosk itself is allowed.
  if (
    request.method === "GET" &&
    !pathname.startsWith("/api/") &&
    pathname !== "/kiosk" &&
    !pathname.startsWith("/kiosk/") &&
    readKioskActiveFromCookie(request.cookies.get("session_user")?.value)
  ) {
    return applyCorsHeaders(NextResponse.redirect(new URL("/kiosk", request.url)), request);
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
