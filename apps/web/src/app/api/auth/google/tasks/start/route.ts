import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { buildGoogleTasksAuthUrl } from "@/lib/google/tasks-api";

const OAUTH_STATE_COOKIE_NAME = "google_tasks_oauth_state";
const OAUTH_STATE_COOKIE_MAX_AGE_SECONDS = 10 * 60;

function resolvePublicOrigin(request: NextRequest) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (configured) {
    return configured;
  }

  const forwardedProto = request.headers.get("x-forwarded-proto");
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  return request.nextUrl.origin;
}

function profileRedirect(request: NextRequest, params: Record<string, string>) {
  const url = new URL("/profile", resolvePublicOrigin(request));
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url, 303);
}

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return profileRedirect(request, { googleTasksError: "unauthorized" });
  }

  try {
    const state = randomUUID();
    const redirectUri = `${resolvePublicOrigin(request)}/api/auth/google/tasks/callback`;
    const authUrl = buildGoogleTasksAuthUrl({
      redirectUri,
      state,
      loginHint: session.email,
    });
    const response = NextResponse.redirect(authUrl, 302);
    response.cookies.set(OAUTH_STATE_COOKIE_NAME, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/auth/google/tasks",
      maxAge: OAUTH_STATE_COOKIE_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 120) : "unknown";
    console.error("[GOOGLE_TASKS_LINK_START_ERROR]", reason);
    return profileRedirect(request, { googleTasksError: "link_start_failed" });
  }
}
