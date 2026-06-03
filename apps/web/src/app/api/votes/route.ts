import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { COMMUNITY_AWARD_TARGET_TYPE } from "@/lib/community-awards";
import { getViewerFamilyContext } from "@/lib/family/member-access";
import { isSupportAdmin } from "@/lib/support/access";
import { writePublicRequestedChangesSnapshotBestEffort } from "@/lib/support/public-requests-snapshot";
import { toggleVote } from "@/lib/voting/service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const candidate = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  try {
    let familyId: string | null = null;
    let refreshed = false;
    let refreshedSession = session;
    if (candidate.targetType === COMMUNITY_AWARD_TARGET_TYPE && !isSupportAdmin(session)) {
      if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
        return NextResponse.json({ error: "reauth_required" }, { status: 401 });
      }
      const access = await runWithRefreshedFirebaseToken(session, async (idToken) => {
        const context = await getViewerFamilyContext(session.uid, session.email, idToken);
        return { familyId: context.familyId, allowed: context.viewerRole === "admin" };
      });
      refreshed = access.refreshed;
      refreshedSession = access.session;
      familyId = access.data.familyId || null;
      if (!access.data.allowed) {
        return NextResponse.json({ error: "family_admin_required" }, { status: 403 });
      }
    }
    const result = await toggleVote({
      targetType: candidate.targetType,
      targetId: candidate.targetId,
      value: candidate.value,
      uid: session.uid,
      familyId,
    });
    if (!result.ok) {
      const status = result.error === "target_not_found" ? 404 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }
    if (candidate.targetType !== COMMUNITY_AWARD_TARGET_TYPE) {
      await writePublicRequestedChangesSnapshotBestEffort();
    }
    const response = NextResponse.json(result);
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("[VOTE_TOGGLE_ERROR]", reason.slice(0, 240));
    return NextResponse.json({ error: "vote_failed" }, { status: 500 });
  }
}
