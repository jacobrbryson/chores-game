import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { patchDocument, stringField, timestampField } from "@/lib/firestore/rest";
import { loadFamilyMemberProfileData } from "@/lib/family/member-profiles";

function jsonUnauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function jsonReauthRequired() {
  return NextResponse.json(
    {
      error: "reauth_required",
      message: "Please sign out and sign in again to refresh your session.",
    },
    { status: 401 },
  );
}

function jsonFirestoreForbidden() {
  return NextResponse.json(
    {
      error: "firestore_forbidden",
      message:
        "Authenticated user does not have access to Firestore documents under current rules.",
    },
    { status: 403 },
  );
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ memberId: string; awardId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  const { memberId, awardId } = await context.params;
  if (!memberId) {
    return NextResponse.json({ error: "member_id_required" }, { status: 400 });
  }
  if (!awardId) {
    return NextResponse.json({ error: "award_id_required" }, { status: 400 });
  }

  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        const loadedProfile = await loadFamilyMemberProfileData({
          viewerUid: session.uid,
          viewerEmail: session.email,
          memberIdentifier: memberId,
          idToken,
        });

        if (loadedProfile.kind !== "ok") {
          return loadedProfile;
        }
        if (loadedProfile.profile.viewerRole !== "admin") {
          return { kind: "forbidden" as const };
        }

        const award = loadedProfile.profile.unclaimedAwards.find((entry) => entry.id === awardId);
        if (!award) {
          if (loadedProfile.profile.claimedAwards.some((entry) => entry.id === awardId)) {
            return { kind: "already_claimed" as const };
          }
          return { kind: "award_not_found" as const };
        }

        const now = new Date().toISOString();
        await patchDocument(
          `families/${loadedProfile.profile.familyId}/awardClaims/${awardId}`,
          {
            status: stringField("claimed"),
            claimedAt: timestampField(now),
            claimedByUid: stringField(session.uid),
            claimedByName: stringField(session.name || session.email || "Admin"),
            updatedAt: timestampField(now),
          },
          idToken,
          ["status", "claimedAt", "claimedByUid", "claimedByName", "updatedAt"],
        );

        return { kind: "ok" as const };
      });

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "member_not_found") {
      return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    }
    if (data.kind === "forbidden") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (data.kind === "award_not_found") {
      return NextResponse.json({ error: "award_not_found" }, { status: 404 });
    }
    if (data.kind === "already_claimed") {
      return NextResponse.json({ error: "already_claimed" }, { status: 409 });
    }

    const response = NextResponse.json({ success: true });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[FAMILY_MEMBER_AWARD_CLAIM_ERROR]", reason);
    if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
      return jsonReauthRequired();
    }
    if (reason.includes("FIRESTORE_HTTP_403")) {
      return jsonFirestoreForbidden();
    }
    if (
      reason.includes("FIRESTORE_HTTP_404") &&
      reason.toLowerCase().includes("document") &&
      reason.toLowerCase().includes("not found")
    ) {
      return NextResponse.json({ error: "award_not_found" }, { status: 404 });
    }
    return NextResponse.json({ error: "claim_award_failed" }, { status: 500 });
  }
}
