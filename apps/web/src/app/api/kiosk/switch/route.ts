import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  enterKioskSession,
  getKioskPlayerIds,
  isKioskActive,
} from "@/lib/auth/session";
import {
  ensureManagedChildProfile,
  getPrimaryFamilyIdForSession,
  resolveFamilyMemberSessionIdentity,
} from "@/lib/auth/account-switch";

type SwitchBody = {
  playerId?: unknown;
};

function jsonUnauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function jsonReauthRequired() {
  return NextResponse.json({ error: "reauth_required" }, { status: 401 });
}

async function resolveKioskMemberIdentity(familyId: string, memberId: string, idToken: string) {
  const rawIdentity = await resolveFamilyMemberSessionIdentity(familyId, memberId, idToken);
  if (!rawIdentity) {
    return null;
  }
  return rawIdentity.role === "player"
    ? await ensureManagedChildProfile(familyId, memberId, idToken)
    : rawIdentity;
}

// Switch the active kiosk profile. No PIN is required because switching is
// roster-limited. Kiosk profiles can be parents, but all kiosk profiles run
// with player-level permissions, so there is no escalation.
// Exiting Kiosk Mode (returning to the signed-in account) still requires the PIN.
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

  let body: SwitchBody;
  try {
    body = (await request.json()) as SwitchBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const playerId = typeof body.playerId === "string" ? body.playerId.trim() : "";
  if (!playerId) {
    return NextResponse.json({ error: "player_id_required" }, { status: 400 });
  }
  // Server-side roster enforcement: never allow switching outside the approved
  // selection, even if the client requests it.
  const roster = getKioskPlayerIds(session);
  if (!roster.includes(playerId)) {
    return NextResponse.json({ error: "not_in_roster" }, { status: 403 });
  }

  try {
    const { data, session: refreshedSession } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        const familyId = await getPrimaryFamilyIdForSession(session, idToken);
        if (!familyId) {
          return { ok: false as const, reason: "family_not_found" as const };
        }
        const memberIdentity = await resolveKioskMemberIdentity(familyId, playerId, idToken);
        if (!memberIdentity) {
          return { ok: false as const, reason: "player_not_found" as const };
        }
        return {
          ok: true as const,
          identity: {
            uid: memberIdentity.uid,
            memberId: memberIdentity.memberId,
            role: memberIdentity.role,
            email: memberIdentity.email,
            name: memberIdentity.name,
            picture: memberIdentity.picture,
            locale: memberIdentity.locale,
          },
        };
      },
    );

    if (!data.ok) {
      if (data.reason === "family_not_found") {
        return NextResponse.json({ error: "family_not_found" }, { status: 404 });
      }
      if (data.reason === "player_not_found") {
        return NextResponse.json({ error: "player_not_found" }, { status: 404 });
      }
      return NextResponse.json({ error: "member_only" }, { status: 400 });
    }

    // Preserve the approved roster across the switch.
    const response = NextResponse.json({ success: true });
    setSessionUserCookie(response, enterKioskSession(refreshedSession, data.identity, roster));
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
      return jsonReauthRequired();
    }
    if (reason.includes("FIRESTORE_HTTP_403")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "kiosk_switch_failed" }, { status: 500 });
  }
}
