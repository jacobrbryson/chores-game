import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  getAuthenticatedSessionIdentity,
  isSessionSwitched,
  switchSessionIdentity,
} from "@/lib/auth/session";
import {
  ensureManagedChildProfile,
  getPrimaryFamilyIdForSession,
  normalizeAccountSwitchPin,
  resolveFamilyMemberSessionIdentity,
  verifyAccountSwitchPin,
} from "@/lib/auth/account-switch";

type StartBody = {
  memberId?: unknown;
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
  if (isSessionSwitched(session)) {
    return NextResponse.json({ error: "already_switched" }, { status: 409 });
  }

  const authenticated = getAuthenticatedSessionIdentity(session);
  if (authenticated.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: StartBody;
  try {
    body = (await request.json()) as StartBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const memberId = typeof body.memberId === "string" ? body.memberId.trim() : "";
  const pin = normalizeAccountSwitchPin(body.pin);
  if (!memberId) {
    return NextResponse.json({ error: "member_id_required" }, { status: 400 });
  }
  if (!pin) {
    return NextResponse.json({ error: "invalid_pin" }, { status: 400 });
  }

  try {
    const { data, session: refreshedSession } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        const pinCheck = await verifyAccountSwitchPin(authenticated.uid, pin, idToken);
        if (!pinCheck.ok) {
          return pinCheck;
        }
        const familyId = await getPrimaryFamilyIdForSession(session, idToken);
        if (!familyId) {
          return { ok: false as const, reason: "family_not_found" as const };
        }
        const rawMemberIdentity = await resolveFamilyMemberSessionIdentity(familyId, memberId, idToken);
        const memberIdentity =
          rawMemberIdentity?.role === "player"
            ? await ensureManagedChildProfile(familyId, memberId, idToken)
            : rawMemberIdentity;
        if (!memberIdentity) {
          return { ok: false as const, reason: "member_not_found" as const };
        }
        if (memberIdentity.role !== "player") {
          return { ok: false as const, reason: "player_only" as const };
        }
        return {
          ok: true as const,
          identity: {
            uid: memberIdentity.uid,
            memberId: memberIdentity.memberId,
            role: "player" as const,
            email: memberIdentity.email,
            name: memberIdentity.name,
            picture: memberIdentity.picture,
          },
        };
      },
    );

    if (!data.ok) {
      if (data.reason === "pin_not_configured") {
        return NextResponse.json({ error: "pin_not_configured" }, { status: 409 });
      }
      if (data.reason === "invalid_pin") {
        return NextResponse.json({ error: "invalid_pin" }, { status: 403 });
      }
      if (data.reason === "family_not_found") {
        return NextResponse.json({ error: "family_not_found" }, { status: 404 });
      }
      if (data.reason === "member_not_found") {
        return NextResponse.json({ error: "member_not_found" }, { status: 404 });
      }
      if (data.reason === "player_only") {
        return NextResponse.json({ error: "player_only" }, { status: 400 });
      }
    }

    const response = NextResponse.json({ success: true });
    setSessionUserCookie(response, switchSessionIdentity(refreshedSession, data.identity));
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
      return jsonReauthRequired();
    }
    if (reason.includes("FIRESTORE_HTTP_403")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "switch_account_failed" }, { status: 500 });
  }
}
