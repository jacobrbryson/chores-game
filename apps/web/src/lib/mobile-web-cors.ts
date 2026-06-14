import { NextRequest, NextResponse } from "next/server";

function normalizeOrigin(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function getConfiguredMobileWebOrigins() {
  return (process.env.MOBILE_WEB_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => normalizeOrigin(value))
    .filter(Boolean);
}

function isAllowedMobileWebOrigin(origin: string, request: NextRequest) {
  const allowedOrigins = new Set([
    "http://localhost:8081",
    "http://127.0.0.1:8081",
    ...getConfiguredMobileWebOrigins(),
  ]);
  if (allowedOrigins.has(origin)) {
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

export function withMobileWebCors(response: NextResponse, request: NextRequest) {
  const origin = normalizeOrigin(request.headers.get("origin") ?? "");
  if (!origin || !isAllowedMobileWebOrigin(origin, request)) {
    return response;
  }

  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Allow-Credentials", "true");
  response.headers.set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.headers.append("Vary", "Origin");
  return response;
}

export function mobileWebCorsPreflight(request: NextRequest) {
  return withMobileWebCors(new NextResponse(null, { status: 204 }), request);
}
