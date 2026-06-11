import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  enterKioskSession,
  getAuthenticatedSessionIdentity,
  isKioskActive,
  isSessionSwitched,
} from "@/lib/auth/session";
import {
  ensureManagedChildProfile,
  getPrimaryFamilyIdForSession,
  normalizeAccountSwitchPin,
  resolveFamilyMemberSessionIdentity,
} from "@/lib/auth/account-switch";
import { verifyKioskPin } from "@/lib/auth/kiosk";

type StartBody = {
  // Roster of player member ids approved for this shared tablet. `playerId`
  // (single) is accepted for backwards compatibility.
  playerIds?: unknown;
  playerId?: unknown;
  pin?: unknown;
};

function normalizePlayerIds(body: StartBody): string[] {
  const ids = Array.isArray(body.playerIds)
    ? body.playerIds
    : typeof body.playerId === "string"
      ? [body.playerId]
      : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of ids) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  return result;
}

function jsonUnauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function jsonReauthRequired() {
  return NextResponse.json({ error: "reauth_required" }, { status: 401 });
}

// Enter Kiosk Mode for a selected player. Any authenticated family member may
// do this (not just admins). The session identity is swapped to the player so
// every downstream endpoint enforces player-level permissions server-side; the
// authenticated account is preserved for exit and event attribution.
export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }
  // A managed-child (account-switch) session cannot also enter kiosk mode, and
  // an active kiosk session must "Switch Player" instead of starting again.
  if (isKioskActive(session) || isSessionSwitched(session)) {
    return NextResponse.json({ error: "already_active" }, { status: 409 });
  }

  const authenticated = getAuthenticatedSessionIdentity(session);

  let body: StartBody;
  try {
    body = (await request.json()) as StartBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const playerIds = normalizePlayerIds(body);
  const pin = normalizeAccountSwitchPin(body.pin);
  if (playerIds.length === 0) {
    return NextResponse.json({ error: "player_id_required" }, { status: 400 });
  }

  try {
    const { data, session: refreshedSession } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        const pinCheck = await verifyKioskPin(authenticated.uid, pin, idToken);
        if (!pinCheck.ok) {
          return { ok: false as const, reason: pinCheck.reason };
        }
        const familyId = await getPrimaryFamilyIdForSession(session, idToken);
        if (!familyId) {
          return { ok: false as const, reason: "family_not_found" as const };
        }
        // Validate every selected member is a real player, and ensure the first
        // is provisioned as the initial active profile. The whole selection
        // becomes the approved roster.
        const roster: string[] = [];
        for (const playerId of playerIds) {
          const rawIdentity = await resolveFamilyMemberSessionIdentity(familyId, playerId, idToken);
          if (!rawIdentity) {
            return { ok: false as const, reason: "player_not_found" as const };
          }
          if (rawIdentity.role !== "player") {
            return { ok: false as const, reason: "player_only" as const };
          }
          roster.push(playerId);
        }
        const activeId = roster[0];
        const memberIdentity = await ensureManagedChildProfile(familyId, activeId, idToken);
        if (!memberIdentity) {
          return { ok: false as const, reason: "player_not_found" as const };
        }
        return {
          ok: true as const,
          roster,
          identity: {
            uid: memberIdentity.uid,
            memberId: memberIdentity.memberId,
            role: "player" as const,
            email: memberIdentity.email,
            name: memberIdentity.name,
            picture: memberIdentity.picture,
            locale: memberIdentity.locale,
          },
        };
      },
    );

    if (!data.ok) {
      if (data.reason === "invalid_pin") {
        return NextResponse.json({ error: "invalid_pin" }, { status: 403 });
      }
      if (data.reason === "family_not_found") {
        return NextResponse.json({ error: "family_not_found" }, { status: 404 });
      }
      if (data.reason === "player_not_found") {
        return NextResponse.json({ error: "player_not_found" }, { status: 404 });
      }
      return NextResponse.json({ error: "player_only" }, { status: 400 });
    }

    const response = NextResponse.json({ success: true });
    setSessionUserCookie(response, enterKioskSession(refreshedSession, data.identity, data.roster));
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
      return jsonReauthRequired();
    }
    if (reason.includes("FIRESTORE_HTTP_403")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "kiosk_start_failed" }, { status: 500 });
  }
}
