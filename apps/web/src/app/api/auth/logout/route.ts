import { NextResponse } from "next/server";
import { getCanonicalAppOrigin } from "@/lib/app-origin";

function clearSessionAndRedirect(request: Request) {
  const url = new URL("/", getCanonicalAppOrigin());
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
