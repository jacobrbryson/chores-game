import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { adminCommitWrites } from "@/lib/firestore/admin";
import { nullField, stringField, timestampField } from "@/lib/firestore/rest";
import {
  COMMUNITY_AWARD_STATUSES,
  communityAwardEditableFields,
  editableCommunityAwardFirestoreFields,
  getCommunityAwardRecord,
  isCommunityAwardStatus,
  syncFamilyRewardSubmissionStatus,
} from "@/lib/community-awards";
import { isSupportAdmin } from "@/lib/support/access";

export const runtime = "nodejs";

type PatchBody = {
  action?: unknown;
  status?: unknown;
  publicTitle?: unknown;
  publicDescription?: unknown;
  publicCoinAmount?: unknown;
  publicImage?: unknown;
  publicImageId?: unknown;
  publicCategory?: unknown;
  publicTags?: unknown;
  rejectionReason?: unknown;
  internalModerationNotes?: unknown;
};

function nextStatusFromAction(action: unknown, fallback: unknown) {
  const actionValue = typeof action === "string" ? action : "";
  if (actionValue === "approve") return "approved";
  if (actionValue === "reject") return "rejected";
  if (actionValue === "hide") return "hidden";
  if (actionValue === "restore") return "approved";
  if (isCommunityAwardStatus(fallback)) return fallback;
  return "";
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ communityAwardId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSupportAdmin(session)) {
    return NextResponse.json({ error: "support_admin_required" }, { status: 403 });
  }

  const { communityAwardId } = await context.params;
  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const existing = await getCommunityAwardRecord(communityAwardId);
    if (!existing) {
      return NextResponse.json({ error: "community_award_not_found" }, { status: 404 });
    }

    const editable = communityAwardEditableFields(body as Record<string, unknown>);
    if (!editable.publicTitle || !editable.publicDescription || editable.publicCoinAmount < 1) {
      return NextResponse.json({ error: "invalid_public_fields" }, { status: 400 });
    }
    const nextStatus = nextStatusFromAction(body.action, body.status);
    if (nextStatus && !COMMUNITY_AWARD_STATUSES.includes(nextStatus)) {
      return NextResponse.json({ error: "invalid_status" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const status = nextStatus || existing.status;
    const reviewedAt = nextStatus ? now : existing.reviewedAt;
    const fields = {
      ...editableCommunityAwardFirestoreFields(editable),
      status: stringField(status),
      reviewedByUid: stringField(nextStatus ? session.uid : existing.reviewedByUid),
      reviewedByEmail: stringField(nextStatus ? session.email : existing.reviewedByEmail),
      reviewedAt: reviewedAt ? timestampField(reviewedAt) : timestampField(now),
      approvedAt:
        status === "approved"
          ? timestampField(existing.approvedAt || now)
          : existing.approvedAt
            ? timestampField(existing.approvedAt)
            : nullField(),
      hiddenAt:
        status === "hidden"
          ? timestampField(now)
          : existing.hiddenAt
            ? timestampField(existing.hiddenAt)
            : nullField(),
      updatedAt: timestampField(now),
    };

    await adminCommitWrites([
      {
        update: {
          path: `communityAwards/${communityAwardId}`,
          fields,
          updateMask: Object.keys(fields),
        },
      },
      {
        update: {
          path: `families/${existing.sourceFamilyId}/auditLogs/${randomUUID()}`,
          fields: {
            familyId: stringField(existing.sourceFamilyId),
            eventType: stringField(`community_award_${nextStatus ? status : "edited"}`),
            actorUid: stringField(session.uid),
            actorEmail: stringField(session.email),
            actorName: stringField(session.name || session.email || "Support"),
            actorRole: stringField("support"),
            userId: stringField(""),
            choreId: stringField(""),
            choreTitle: stringField(""),
            source: stringField("support_admin"),
            reason: stringField(`Support updated community award ${communityAwardId}.`),
            requestId: stringField(communityAwardId),
            previous: { mapValue: { fields: {} } },
            next: { mapValue: { fields: { status: stringField(status) } } },
            createdAt: timestampField(now),
          },
        },
      },
    ]);

    if (nextStatus) {
      await syncFamilyRewardSubmissionStatus({
        familyId: existing.sourceFamilyId,
        rewardId: existing.sourceRewardId,
        submissionId: communityAwardId,
        status,
        reviewedAt,
        rejectionReason: status === "rejected" ? editable.rejectionReason : "",
      });
    }

    return NextResponse.json({ award: await getCommunityAwardRecord(communityAwardId) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("[SUPPORT_COMMUNITY_AWARD_PATCH_ERROR]", reason.slice(0, 240));
    return NextResponse.json({ error: "support_community_award_update_failed" }, { status: 500 });
  }
}
