import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { getCanonicalAppOrigin } from "@/lib/app-origin";
import { exchangeGoogleTasksAuthCode, listGoogleTaskLists } from "@/lib/google/tasks-api";
import { persistGoogleTasksOAuthLink } from "@/lib/google/tasks-link";

const OAUTH_STATE_COOKIE_NAME = "google_tasks_oauth_state";

function profileRedirect(request: NextRequest, params: Record<string, string>) {
  const url = new URL("/profile", getCanonicalAppOrigin());
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url, 303);
}

function clearOAuthStateCookie(response: NextResponse) {
  response.cookies.set(OAUTH_STATE_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/google/tasks",
    maxAge: 0,
  });
}

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    const redirect = profileRedirect(request, { googleTasksError: "unauthorized" });
    clearOAuthStateCookie(redirect);
    return redirect;
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    const redirect = profileRedirect(request, { googleTasksError: "reauth_required" });
    clearOAuthStateCookie(redirect);
    return redirect;
  }

  const code = request.nextUrl.searchParams.get("code") ?? "";
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const stateCookie = request.cookies.get(OAUTH_STATE_COOKIE_NAME)?.value ?? "";

  if (!code) {
    const redirect = profileRedirect(request, { googleTasksError: "missing_code" });
    clearOAuthStateCookie(redirect);
    return redirect;
  }
  if (!state || !stateCookie || state !== stateCookie) {
    const redirect = profileRedirect(request, { googleTasksError: "invalid_state" });
    clearOAuthStateCookie(redirect);
    return redirect;
  }

  try {
    const { session: refreshedSession, refreshed } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        const redirectUri = `${getCanonicalAppOrigin()}/api/auth/google/tasks/callback`;
        const token = await exchangeGoogleTasksAuthCode({
          code,
          redirectUri,
        });
        const taskLists = await listGoogleTaskLists(token.accessToken);
        const selectedTaskList =
          taskLists.find((entry) => entry.isDefault) ??
          taskLists[0] ??
          null;
        await persistGoogleTasksOAuthLink({
          uid: session.uid,
          idToken,
          token,
          selectedTaskLists: selectedTaskList ? [selectedTaskList] : [],
        });
        return null;
      },
    );

    const redirect = profileRedirect(request, { googleTasks: "linked" });
    clearOAuthStateCookie(redirect);
    if (refreshed) {
      setSessionUserCookie(redirect, refreshedSession);
    }
    return redirect;
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
    console.error("[GOOGLE_TASKS_LINK_CALLBACK_ERROR]", reason);
    const redirect = profileRedirect(request, { googleTasksError: "link_failed" });
    clearOAuthStateCookie(redirect);
    return redirect;
  }
}


