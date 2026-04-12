import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  getAuthenticatedSessionIdentity,
  isSessionSwitched,
} from "@/lib/auth/session";
import {
  normalizeAccountSwitchPin,
  setAccountSwitchPin,
} from "@/lib/auth/account-switch";

type PinBody = {
  pin?: unknown;
  confirmPin?: unknown;
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

  const authenticated = getAuthenticatedSessionIdentity(session);
  if (authenticated.role !== "admin" || isSessionSwitched(session)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: PinBody;
  try {
    body = (await request.json()) as PinBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const pin = normalizeAccountSwitchPin(body.pin);
  const confirmPin = normalizeAccountSwitchPin(body.confirmPin);
  if (!pin) {
    return NextResponse.json({ error: "invalid_pin" }, { status: 400 });
  }
  if (pin !== confirmPin) {
    return NextResponse.json({ error: "pin_mismatch" }, { status: 400 });
  }

  try {
    const { session: refreshedSession, refreshed } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        await setAccountSwitchPin(authenticated.uid, pin, idToken);
        return null;
      },
    );
    const response = NextResponse.json({ success: true });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
      return jsonReauthRequired();
    }
    if (reason.includes("FIRESTORE_HTTP_403")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "pin_update_failed" }, { status: 500 });
  }
}
