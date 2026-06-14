import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  getPrimaryFamilyId,
  getViewerRole,
  jsonReauthRequired,
  jsonUnauthorized,
  mapCommonFirestoreErrors,
} from "@/lib/family/access";
import { getResponsibilityProgress } from "@/lib/responsibility/service";

// Returns a player's aggregated Responsibility Pillar progress (per-pillar XP
// and levels plus totals). Players can read their own progress; family admins
// can read any member's by passing ?memberId=<uid>.
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  const requestedMemberId = request.nextUrl.searchParams.get("memberId")?.trim() ?? "";

  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        const familyId = await getPrimaryFamilyId(session.uid, idToken);
        if (!familyId) {
          return { kind: "family_not_found" as const };
        }
        let targetUid = session.uid;
        if (requestedMemberId && requestedMemberId !== session.uid) {
          const viewerRole = await getViewerRole(familyId, session.uid, idToken);
          if (viewerRole !== "admin") {
            return { kind: "forbidden_action" as const };
          }
          targetUid = requestedMemberId;
        }
        const progress = await getResponsibilityProgress({
          familyId,
          playerUid: targetUid,
          idToken,
        });
        return { kind: "ok" as const, progress };
      });

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "forbidden_action") {
      return NextResponse.json({ error: "forbidden_action" }, { status: 403 });
    }
    const response = NextResponse.json({ progress: data.progress });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[RESPONSIBILITY_PROGRESS_GET_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "responsibility_progress_unavailable");
  }
}
