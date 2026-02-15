import { NextResponse } from "next/server";

function resolvePublicOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (configured) {
    return configured;
  }

  const proto = request.headers.get("x-forwarded-proto");
  const host = request.headers.get("x-forwarded-host");
  if (proto && host) {
    return `${proto}://${host}`;
  }

  return new URL(request.url).origin;
}

function clearSessionAndRedirect(request: Request) {
  const url = new URL("/", resolvePublicOrigin(request));
  const response = NextResponse.redirect(url, 303);
  response.cookies.set("session_user", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export async function POST(request: Request) {
  return clearSessionAndRedirect(request);
}
