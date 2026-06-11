import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  getAuthenticatedSessionIdentity,
  getKioskPlayerIds,
  isKioskActive,
} from "@/lib/auth/session";
import { getPrimaryFamilyIdForSession } from "@/lib/auth/account-switch";
import { kioskPinConfigured } from "@/lib/auth/kiosk";

export const dynamic = "force-dynamic";

function jsonUnauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function jsonReauthRequired() {
  return NextResponse.json({ error: "reauth_required" }, { status: 401 });
}

// Lightweight status probe used by the profile menu (to decide whether to show
// the Kiosk Mode entry) and the kiosk entry screen (to decide whether to render
// the PIN field). Never mutates anything.
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  const authenticated = getAuthenticatedSessionIdentity(session);

  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        const familyId = await getPrimaryFamilyIdForSession(session, idToken);
        if (!familyId) {
          return { inFamily: false as const, pinRequired: false };
        }
        const pinRequired = await kioskPinConfigured(authenticated.uid, idToken);
        return { inFamily: true as const, pinRequired };
      });

    const response = NextResponse.json({
      active: isKioskActive(session),
      inFamily: data.inFamily,
      pinRequired: data.pinRequired,
      playerIds: getKioskPlayerIds(session),
      authenticatedName: authenticated.name || authenticated.email || "",
    });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
      return jsonReauthRequired();
    }
    return NextResponse.json({ error: "kiosk_status_failed" }, { status: 500 });
  }
}
