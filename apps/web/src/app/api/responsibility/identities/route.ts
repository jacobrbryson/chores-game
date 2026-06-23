import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  getPrimaryFamilyId,
  jsonReauthRequired,
  jsonUnauthorized,
  mapCommonFirestoreErrors,
} from "@/lib/family/access";
import { getFamilyResponsibilityIdentities } from "@/lib/responsibility/service";

// Returns every family member's Responsibility Identity summary (started-pillar
// titles) in one read, keyed by player uid. Any family member may read it — the
// content is non-sensitive identity used by the V2 recognition surfaces
// (profile/kiosk selection chips, parent Family Growth). Names/avatars are
// joined client-side from the family summary the callers already load.
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        const familyId = await getPrimaryFamilyId(session.uid, idToken);
        if (!familyId) {
          return { kind: "family_not_found" as const };
        }
        const members = await getFamilyResponsibilityIdentities({ familyId, idToken });
        return { kind: "ok" as const, members };
      });

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    const response = NextResponse.json({
      members: Object.entries(data.members).map(([uid, identities]) => ({ uid, identities })),
    });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[RESPONSIBILITY_IDENTITIES_GET_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "responsibility_identities_unavailable");
  }
}
