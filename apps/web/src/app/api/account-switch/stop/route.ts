import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { isSessionSwitched, restoreAuthenticatedSession } from "@/lib/auth/session";
import {
  getAuthenticatedUid,
  normalizeAccountSwitchPin,
  verifyAccountSwitchPin,
} from "@/lib/auth/account-switch";

type StopBody = {
  pin?: unknown;
};

function jsonUnauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function jsonReauthRequired() {
  return NextResponse.json({ error: "reauth_required" }, { status: 401 });
}

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }
  if (!isSessionSwitched(session)) {
    return NextResponse.json({ error: "not_switched" }, { status: 409 });
  }

  let body: StopBody;
  try {
    body = (await request.json()) as StopBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const pin = normalizeAccountSwitchPin(body.pin);
  if (!pin) {
    return NextResponse.json({ error: "invalid_pin" }, { status: 400 });
  }

  try {
    const { data, session: refreshedSession } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => verifyAccountSwitchPin(getAuthenticatedUid(session), pin, idToken),
    );
    if (!data.ok) {
      if (data.reason === "pin_not_configured") {
        return NextResponse.json({ error: "pin_not_configured" }, { status: 409 });
      }
      if (data.reason === "invalid_pin") {
        return NextResponse.json({ error: "invalid_pin" }, { status: 403 });
      }
    }
    const response = NextResponse.json({ success: true });
    setSessionUserCookie(response, restoreAuthenticatedSession(refreshedSession));
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
      return jsonReauthRequired();
    }
    if (reason.includes("FIRESTORE_HTTP_403")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "restore_account_failed" }, { status: 500 });
  }
}
