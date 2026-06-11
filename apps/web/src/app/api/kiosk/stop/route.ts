import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  exitKioskSession,
  getAuthenticatedSessionIdentity,
  isKioskActive,
} from "@/lib/auth/session";
import { normalizeAccountSwitchPin } from "@/lib/auth/account-switch";
import { verifyKioskPin } from "@/lib/auth/kiosk";

type StopBody = {
  pin?: unknown;
};

function jsonUnauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function jsonReauthRequired() {
  return NextResponse.json({ error: "reauth_required" }, { status: 401 });
}

// Exit Kiosk Mode and return to the original signed-in account with its normal
// permissions. Requires the profile-switch PIN (verified against the
// authenticated account) when one is configured.
export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }
  if (!isKioskActive(session)) {
    return NextResponse.json({ error: "not_active" }, { status: 409 });
  }

  const authenticated = getAuthenticatedSessionIdentity(session);

  let body: StopBody;
  try {
    body = (await request.json()) as StopBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const pin = normalizeAccountSwitchPin(body.pin);

  try {
    const { data, session: refreshedSession } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => verifyKioskPin(authenticated.uid, pin, idToken),
    );
    if (!data.ok) {
      return NextResponse.json({ error: "invalid_pin" }, { status: 403 });
    }
    const response = NextResponse.json({ success: true });
    setSessionUserCookie(response, exitKioskSession(refreshedSession));
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
      return jsonReauthRequired();
    }
    return NextResponse.json({ error: "kiosk_stop_failed" }, { status: 500 });
  }
}
