import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { writeAuditLogBestEffort } from "@/lib/audit/log";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { listFamilyFriends } from "@/lib/family-friends/repository";
import { getViewerFamilyContext } from "@/lib/family/member-access";
import { adminGetDocument } from "@/lib/firestore/admin";
import {
  boolField,
  createOrReplaceDocument,
  integerField,
  nullField,
  readBoolean,
  readInteger,
  readString,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import { emitFamilyActivity } from "@/lib/notifications/events";
import { publishFamilyActivity } from "@/lib/ws/publish-family-activity";

type CopyBody = { sourceFamilyId?: unknown; rewardId?: unknown };

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: CopyBody;
  try {
    body = (await request.json()) as CopyBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const sourceFamilyId = typeof body.sourceFamilyId === "string" ? body.sourceFamilyId.trim() : "";
  const sourceRewardId = typeof body.rewardId === "string" ? body.rewardId.trim() : "";
  if (!sourceFamilyId || !sourceRewardId) {
    return NextResponse.json({ error: "source_required" }, { status: 400 });
  }

  try {
    const result = await runWithRefreshedFirebaseToken(session, async (idToken) => {
      const context = await getViewerFamilyContext(session.uid, session.email, idToken);
      if (!context.familyId) return { kind: "family_not_found" as const };
      if (context.viewerRole !== "admin") return { kind: "forbidden" as const };
      const isFriend = (await listFamilyFriends(context.familyId)).some(
        (friend) => friend.familyId === sourceFamilyId,
      );
      if (!isFriend) return { kind: "not_family_friends" as const };

      let sourceReward;
      try {
        sourceReward = await adminGetDocument(`families/${sourceFamilyId}/rewards/${sourceRewardId}`);
      } catch (error) {
        if (error instanceof Error && error.message.includes("FIRESTORE_ADMIN_HTTP_404")) {
          return { kind: "reward_not_found" as const };
        }
        throw error;
      }
      if (readBoolean(sourceReward.fields, "deleted") || readBoolean(sourceReward.fields, "disabled")) {
        return { kind: "reward_not_found" as const };
      }
      const description = readString(sourceReward.fields, "description");
      const coinCost = readInteger(sourceReward.fields, "coinCost");
      const imageId = readString(sourceReward.fields, "imageId");
      if (!description || coinCost < 0 || !imageId) return { kind: "reward_not_found" as const };

      const rewardId = randomUUID();
      const now = new Date().toISOString();
      await createOrReplaceDocument(
        `families/${context.familyId}/rewards/${rewardId}`,
        {
          description: stringField(description),
          coinCost: integerField(coinCost),
          imageId: stringField(imageId),
          individualLimit: integerField(readInteger(sourceReward.fields, "individualLimit")),
          familyLimit: integerField(readInteger(sourceReward.fields, "familyLimit")),
          familyRedeemedCount: integerField(0),
          disabled: boolField(false),
          deleted: boolField(false),
          submitToCommunityAwards: boolField(false),
          communityAwardSubmissionId: stringField(""),
          communityAwardSubmissionStatus: stringField(""),
          communityAwardSubmittedAt: nullField(),
          communityAwardReviewedAt: nullField(),
          communityAwardRejectionReason: stringField(""),
          copiedFromFriendFamilyId: stringField(sourceFamilyId),
          copiedFromFriendRewardId: stringField(sourceRewardId),
          createdBy: stringField(session.uid),
          createdAt: timestampField(now),
          updatedAt: timestampField(now),
        },
        idToken,
      );
      await emitFamilyActivity({
        familyId: context.familyId,
        idToken,
        kind: "family_reward_created",
        actorUid: session.uid,
        actorEmail: session.email,
        actorName: session.name,
        title: `${session.name || "A parent"} added a Family Award`,
        message: `${description} for ${coinCost} coins`,
        rewardId,
        rewardDescription: description,
        rewardCoinCost: coinCost,
        rewardImageId: imageId,
      });
      await publishFamilyActivity({ type: "family_reward_created", familyId: context.familyId, occurredAt: now });
      void writeAuditLogBestEffort({
        familyId: context.familyId,
        idToken,
        eventType: "family_friend_award_copied",
        actor: { uid: session.uid, email: session.email, name: session.name, role: "admin" },
        source: "family_friends",
        requestId: rewardId,
        next: { sourceFamilyId, sourceRewardId, rewardId },
      });
      return { kind: "ok" as const, rewardId };
    });
    if (result.data.kind !== "ok") {
      const status = result.data.kind === "forbidden" || result.data.kind === "not_family_friends" ? 403 : 404;
      return NextResponse.json({ error: result.data.kind }, { status });
    }
    const response = NextResponse.json({ rewardId: result.data.rewardId }, { status: 201 });
    if (result.refreshed) setSessionUserCookie(response, result.session);
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
    console.error("[FAMILY_FRIEND_AWARD_COPY_ERROR]", reason);
    return NextResponse.json({ error: "family_friend_award_copy_failed" }, { status: 500 });
  }
}
