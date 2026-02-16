import { NextResponse } from "next/server";
import {
  createSessionToken,
  SESSION_COOKIE_MAX_AGE,
  type SessionUser,
} from "@/lib/auth/session";

export function setSessionUserCookie(response: NextResponse, sessionUser: SessionUser) {
  const sessionValue = createSessionToken(sessionUser);
  if (!sessionValue) {
    throw new Error("SESSION_COOKIE_CONFIG_MISSING");
  }

  response.cookies.set("session_user", sessionValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE,
  });
}
