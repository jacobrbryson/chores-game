import { NextRequest, NextResponse } from "next/server";

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
  if (request.method === "OPTIONS") {
    return applyCorsHeaders(new NextResponse(null, { status: 204 }), request);
  }

  return applyCorsHeaders(NextResponse.next(), request);
}

export const config = {
  matcher: ["/api/v1/:path*", "/api/auth/google/mobile", "/api/auth/logout"],
};
