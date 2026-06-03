import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { adminCommitWrites } from "@/lib/firestore/admin";
import {
  boolField,
  integerField,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import { getCommunityAwardRecord } from "@/lib/community-awards";
import { getViewerFamilyContext } from "@/lib/family/member-access";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ communityAwardId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return NextResponse.json({ error: "reauth_required" }, { status: 401 });
  }

  const { communityAwardId } = await context.params;
  if (!communityAwardId) {
    return NextResponse.json({ error: "community_award_id_required" }, { status: 400 });
  }

  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        const familyContext = await getViewerFamilyContext(session.uid, session.email, idToken);
        if (!familyContext.familyId) {
          return { kind: "family_not_found" as const };
        }
        if (familyContext.viewerRole !== "admin") {
          return { kind: "forbidden_action" as const };
        }
        const award = await getCommunityAwardRecord(communityAwardId);
        if (!award || award.status !== "approved") {
          return { kind: "community_award_not_found" as const };
        }

        const now = new Date().toISOString();
        const rewardId = randomUUID();
        const auditId = randomUUID();
        await adminCommitWrites([
          {
            update: {
              path: `families/${familyContext.familyId}/rewards/${rewardId}`,
              fields: {
                description: stringField(award.publicTitle || award.publicDescription),
                coinCost: integerField(award.publicCoinAmount),
                imageId: stringField(award.publicImage),
                individualLimit: integerField(0),
                familyLimit: integerField(0),
                familyRedeemedCount: integerField(0),
                disabled: boolField(false),
                deleted: boolField(false),
                submitToCommunityAwards: boolField(false),
                communityAwardSubmissionId: stringField(""),
                communityAwardSubmissionStatus: stringField(""),
                communityAwardRejectionReason: stringField(""),
                copiedFromCommunityAwardId: stringField(award.id),
                createdBy: stringField(session.uid),
                createdAt: timestampField(now),
                updatedAt: timestampField(now),
              },
            },
          },
          {
            transform: {
              path: `communityAwards/${award.id}`,
              fieldTransforms: [{ fieldPath: "copyCount", increment: integerField(1) }],
            },
          },
          {
            update: {
              path: `families/${familyContext.familyId}/auditLogs/${auditId}`,
              fields: {
                familyId: stringField(familyContext.familyId),
                eventType: stringField("community_award_copied"),
                actorUid: stringField(session.uid),
                actorEmail: stringField(session.email),
                actorName: stringField(session.name || session.email || "Admin"),
                actorRole: stringField("admin"),
                userId: stringField(""),
                choreId: stringField(""),
                choreTitle: stringField(""),
                source: stringField("community_awards"),
                reason: stringField(`Copied community award ${award.id} into family rewards.`),
                requestId: stringField(award.id),
                previous: { mapValue: { fields: {} } },
                next: { mapValue: { fields: { rewardId: stringField(rewardId) } } },
                createdAt: timestampField(now),
              },
            },
          },
        ]);
        return { kind: "ok" as const, rewardId };
      });

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "forbidden_action") {
      return NextResponse.json({ error: "forbidden_action" }, { status: 403 });
    }
    if (data.kind === "community_award_not_found") {
      return NextResponse.json({ error: "community_award_not_found" }, { status: 404 });
    }

    const response = NextResponse.json({ rewardId: data.rewardId }, { status: 201 });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("[COMMUNITY_AWARD_COPY_ERROR]", reason.slice(0, 240));
    return NextResponse.json({ error: "community_award_copy_failed" }, { status: 500 });
  }
}
