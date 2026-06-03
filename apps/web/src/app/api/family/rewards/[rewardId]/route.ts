import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  boolField,
  findFirstFamilyIdByMemberUid,
  getDocument,
  integerField,
  listDocuments,
  patchDocument,
  readBoolean,
  readInteger,
  readString,
  readStringArray,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import {
  submitFamilyRewardToCommunity,
  withdrawFamilyRewardCommunitySubmission,
} from "@/lib/community-awards";
import {
  isFamilyRewardImageId,
  isValidFamilyRewardCoinCost,
  isValidFamilyRewardLimit,
  MAX_FAMILY_REWARD_LIMIT,
  MAX_FAMILY_REWARD_DESCRIPTION_LENGTH,
  normalizeFamilyRewardCoinCost,
  normalizeFamilyRewardDescription,
  normalizeFamilyRewardLimit,
} from "@/lib/family/rewards";

type UpdateRewardBody = {
  description?: unknown;
  coinCost?: unknown;
  imageId?: unknown;
  individualLimit?: unknown;
  familyLimit?: unknown;
  disabled?: unknown;
  submitToCommunityAwards?: unknown;
};

type ViewerRole = "admin" | "player";

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

function mapCommonFirestoreErrors(reason: string, fallbackError: string) {
  if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
    return jsonReauthRequired();
  }
  if (reason.includes("FIRESTORE_HTTP_403")) {
    return jsonFirestoreForbidden();
  }
  return NextResponse.json({ error: fallbackError }, { status: 500 });
}

async function getPrimaryFamilyId(uid: string, idToken: string) {
  let familyId = "";
  try {
    const userDoc = await getDocument(`users/${uid}`, idToken);
    familyId = readStringArray(userDoc.fields, "familyIds")[0] ?? "";
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_HTTP_404")) {
      throw error;
    }
  }
  if (familyId) {
    return familyId;
  }
  return findFirstFamilyIdByMemberUid(uid, idToken);
}

async function getViewerRole(
  familyId: string,
  uid: string,
  idToken: string,
): Promise<ViewerRole> {
  try {
    const memberDoc = await getDocument(`families/${familyId}/members/${uid}`, idToken);
    if (readBoolean(memberDoc.fields, "deleted")) {
      return "player";
    }
    return readString(memberDoc.fields, "role") === "admin" ? "admin" : "player";
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_HTTP_404")) {
      throw error;
    }
  }

  const memberDocs = await listDocuments(`families/${familyId}/members`, idToken, 200);
  const memberByUid = memberDocs.find((doc) => {
    if (readBoolean(doc.fields, "deleted")) {
      return false;
    }
    return readString(doc.fields, "uid") === uid;
  });
  if (!memberByUid) {
    return "player";
  }
  return readString(memberByUid.fields, "role") === "admin" ? "admin" : "player";
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ rewardId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  const { rewardId } = await context.params;
  if (!rewardId) {
    return NextResponse.json({ error: "reward_id_required" }, { status: 400 });
  }

  let body: UpdateRewardBody;
  try {
    body = (await request.json()) as UpdateRewardBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const hasDescription = typeof body.description === "string";
  const hasCoinCost = body.coinCost !== undefined;
  const hasImageId = typeof body.imageId === "string";
  const hasIndividualLimit = body.individualLimit !== undefined;
  const hasFamilyLimit = body.familyLimit !== undefined;
  const hasDisabled = body.disabled !== undefined;
  const hasSubmitToCommunityAwards = body.submitToCommunityAwards !== undefined;
  if (
    !hasDescription &&
    !hasCoinCost &&
    !hasImageId &&
    !hasIndividualLimit &&
    !hasFamilyLimit &&
    !hasDisabled &&
    !hasSubmitToCommunityAwards
  ) {
    return NextResponse.json({ error: "update_values_required" }, { status: 400 });
  }

  const description = hasDescription ? normalizeFamilyRewardDescription(String(body.description)) : "";
  const coinCost = hasCoinCost ? normalizeFamilyRewardCoinCost(body.coinCost) : 0;
  const imageId = hasImageId ? String(body.imageId).trim() : "";
  const individualLimit = hasIndividualLimit ? normalizeFamilyRewardLimit(body.individualLimit) : 0;
  const familyLimit = hasFamilyLimit ? normalizeFamilyRewardLimit(body.familyLimit) : 0;
  const disabled = hasDisabled ? body.disabled === true : false;
  const submitToCommunityAwards = hasSubmitToCommunityAwards ? body.submitToCommunityAwards === true : false;

  if (hasDescription && !description) {
    return NextResponse.json({ error: "description_required" }, { status: 400 });
  }
  if (hasDescription && description.length > MAX_FAMILY_REWARD_DESCRIPTION_LENGTH) {
    return NextResponse.json({ error: "description_too_long" }, { status: 400 });
  }
  if (hasCoinCost && !isValidFamilyRewardCoinCost(coinCost)) {
    return NextResponse.json({ error: "invalid_coin_cost" }, { status: 400 });
  }
  if (hasImageId && !isFamilyRewardImageId(imageId)) {
    return NextResponse.json({ error: "invalid_image_id" }, { status: 400 });
  }
  if (hasIndividualLimit && !isValidFamilyRewardLimit(individualLimit)) {
    return NextResponse.json(
      { error: "invalid_individual_limit", max: MAX_FAMILY_REWARD_LIMIT },
      { status: 400 },
    );
  }
  if (hasFamilyLimit && !isValidFamilyRewardLimit(familyLimit)) {
    return NextResponse.json(
      { error: "invalid_family_limit", max: MAX_FAMILY_REWARD_LIMIT },
      { status: 400 },
    );
  }

  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        const familyId = await getPrimaryFamilyId(session.uid, idToken);
        if (!familyId) {
          return { kind: "family_not_found" as const };
        }

        const viewerRole = await getViewerRole(familyId, session.uid, idToken);
        if (viewerRole !== "admin") {
          return { kind: "forbidden_action" as const };
        }

        let rewardDoc;
        try {
          rewardDoc = await getDocument(`families/${familyId}/rewards/${rewardId}`, idToken);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "";
          if (reason.includes("FIRESTORE_HTTP_404")) {
            return { kind: "reward_not_found" as const };
          }
          throw error;
        }

        if (readBoolean(rewardDoc.fields, "deleted")) {
          return { kind: "reward_not_found" as const };
        }

        const existingDescription = normalizeFamilyRewardDescription(readString(rewardDoc.fields, "description"));
        const existingCoinCost = normalizeFamilyRewardCoinCost(readInteger(rewardDoc.fields, "coinCost"));
        const existingImageId = readString(rewardDoc.fields, "imageId").trim();
        const existingDisabled = readBoolean(rewardDoc.fields, "disabled");
        const existingSubmitToCommunityAwards = readBoolean(rewardDoc.fields, "submitToCommunityAwards");
        const existingSubmissionId = readString(rewardDoc.fields, "communityAwardSubmissionId");
        const existingSubmissionStatus = readString(rewardDoc.fields, "communityAwardSubmissionStatus");
        const existingCreatedAt = readString(rewardDoc.fields, "createdAt");
        const existingIndividualLimit = normalizeFamilyRewardLimit(
          readInteger(rewardDoc.fields, "individualLimit"),
        );
        const existingFamilyLimit = normalizeFamilyRewardLimit(
          readInteger(rewardDoc.fields, "familyLimit"),
        );

        const nextDescription = hasDescription ? description : existingDescription;
        const nextCoinCost = hasCoinCost ? coinCost : existingCoinCost;
        const nextImageId = hasImageId ? imageId : existingImageId;
        const nextDisabled = hasDisabled ? disabled : existingDisabled;
        const nextSubmitToCommunityAwards = hasSubmitToCommunityAwards
          ? submitToCommunityAwards
          : existingSubmitToCommunityAwards;
        const nextIndividualLimit = hasIndividualLimit ? individualLimit : existingIndividualLimit;
        const nextFamilyLimit = hasFamilyLimit ? familyLimit : existingFamilyLimit;

        if (!nextDescription) {
          return { kind: "description_required" as const };
        }
        if (!isValidFamilyRewardCoinCost(nextCoinCost)) {
          return { kind: "invalid_coin_cost" as const };
        }
        if (!isFamilyRewardImageId(nextImageId)) {
          return { kind: "invalid_image_id" as const };
        }
        if (!isValidFamilyRewardLimit(nextIndividualLimit)) {
          return { kind: "invalid_individual_limit" as const };
        }
        if (!isValidFamilyRewardLimit(nextFamilyLimit)) {
          return { kind: "invalid_family_limit" as const };
        }

        const now = new Date().toISOString();
        await patchDocument(
          `families/${familyId}/rewards/${rewardId}`,
          {
            description: stringField(nextDescription),
            coinCost: integerField(nextCoinCost),
            imageId: stringField(nextImageId),
            individualLimit: integerField(nextIndividualLimit),
            familyLimit: integerField(nextFamilyLimit),
            disabled: boolField(nextDisabled),
            submitToCommunityAwards: boolField(nextSubmitToCommunityAwards),
            updatedAt: timestampField(now),
          },
          idToken,
          ["description", "coinCost", "imageId", "individualLimit", "familyLimit", "disabled", "submitToCommunityAwards", "updatedAt"],
        );
        let communityAwardSubmissionId = existingSubmissionId || null;
        let communityAwardSubmissionStatus = existingSubmissionStatus || null;
        let communityAwardSubmittedAt: string | null = null;
        const canUpsertCommunitySubmission =
          hasSubmitToCommunityAwards &&
          nextSubmitToCommunityAwards &&
          (
            !existingSubmitToCommunityAwards ||
            existingSubmissionStatus === "pending_review" ||
            existingSubmissionStatus === "rejected" ||
            existingSubmissionStatus === "withdrawn"
          );
        if (canUpsertCommunitySubmission) {
          communityAwardSubmissionId = await submitFamilyRewardToCommunity({
            familyId,
            rewardId,
            submittedByUid: session.uid,
            submittedByEmail: session.email ?? "",
            description: nextDescription,
            coinCost: nextCoinCost,
            imageId: nextImageId,
            existingSubmissionId,
            existingStatus: existingSubmissionStatus,
            rewardCreatedAt: existingCreatedAt,
          });
          communityAwardSubmissionStatus = "pending_review";
          communityAwardSubmittedAt = now;
        } else if (hasSubmitToCommunityAwards && !nextSubmitToCommunityAwards && existingSubmitToCommunityAwards) {
          await withdrawFamilyRewardCommunitySubmission({
            familyId,
            rewardId,
            actorUid: session.uid,
            actorEmail: session.email ?? "",
            submissionId: existingSubmissionId,
            existingStatus: existingSubmissionStatus,
          });
          communityAwardSubmissionStatus =
            existingSubmissionStatus === "approved" || existingSubmissionStatus === "hidden"
              ? existingSubmissionStatus
              : "withdrawn";
        }

        return {
          kind: "ok" as const,
          reward: {
            id: rewardId,
            description: nextDescription,
            coinCost: nextCoinCost,
            imageId: nextImageId,
            individualLimit: nextIndividualLimit > 0 ? nextIndividualLimit : undefined,
            familyLimit: nextFamilyLimit > 0 ? nextFamilyLimit : undefined,
            disabled: nextDisabled,
            submitToCommunityAwards: nextSubmitToCommunityAwards,
            communityAwardSubmissionId,
            communityAwardSubmissionStatus,
            communityAwardSubmittedAt,
          },
        };
      });

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "forbidden_action") {
      return NextResponse.json({ error: "forbidden_action" }, { status: 403 });
    }
    if (data.kind === "reward_not_found") {
      return NextResponse.json({ error: "reward_not_found" }, { status: 404 });
    }
    if (data.kind === "description_required") {
      return NextResponse.json({ error: "description_required" }, { status: 400 });
    }
    if (data.kind === "invalid_coin_cost") {
      return NextResponse.json({ error: "invalid_coin_cost" }, { status: 400 });
    }
    if (data.kind === "invalid_image_id") {
      return NextResponse.json({ error: "invalid_image_id" }, { status: 400 });
    }
    if (data.kind === "invalid_individual_limit") {
      return NextResponse.json(
        { error: "invalid_individual_limit", max: MAX_FAMILY_REWARD_LIMIT },
        { status: 400 },
      );
    }
    if (data.kind === "invalid_family_limit") {
      return NextResponse.json(
        { error: "invalid_family_limit", max: MAX_FAMILY_REWARD_LIMIT },
        { status: 400 },
      );
    }

    const response = NextResponse.json({ reward: data.reward });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[FAMILY_REWARD_PATCH_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "update_family_reward_failed");
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ rewardId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  const { rewardId } = await context.params;
  if (!rewardId) {
    return NextResponse.json({ error: "reward_id_required" }, { status: 400 });
  }

  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        const familyId = await getPrimaryFamilyId(session.uid, idToken);
        if (!familyId) {
          return { kind: "family_not_found" as const };
        }

        const viewerRole = await getViewerRole(familyId, session.uid, idToken);
        if (viewerRole !== "admin") {
          return { kind: "forbidden_action" as const };
        }

        let rewardDoc;
        try {
          rewardDoc = await getDocument(`families/${familyId}/rewards/${rewardId}`, idToken);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "";
          if (reason.includes("FIRESTORE_HTTP_404")) {
            return { kind: "reward_not_found" as const };
          }
          throw error;
        }

        if (readBoolean(rewardDoc.fields, "deleted")) {
          return { kind: "reward_not_found" as const };
        }
        if (!readBoolean(rewardDoc.fields, "disabled")) {
          return { kind: "reward_must_be_disabled" as const };
        }

        const now = new Date().toISOString();
        await patchDocument(
          `families/${familyId}/rewards/${rewardId}`,
          {
            deleted: boolField(true),
            deletedAt: timestampField(now),
            updatedAt: timestampField(now),
          },
          idToken,
          ["deleted", "deletedAt", "updatedAt"],
        );

        return { kind: "ok" as const };
      });

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "forbidden_action") {
      return NextResponse.json({ error: "forbidden_action" }, { status: 403 });
    }
    if (data.kind === "reward_not_found") {
      return NextResponse.json({ error: "reward_not_found" }, { status: 404 });
    }
    if (data.kind === "reward_must_be_disabled") {
      return NextResponse.json({ error: "reward_must_be_disabled" }, { status: 409 });
    }

    const response = NextResponse.json({ success: true });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[FAMILY_REWARD_DELETE_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "delete_family_reward_failed");
  }
}
