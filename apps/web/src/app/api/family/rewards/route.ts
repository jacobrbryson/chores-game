import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  boolField,
  createOrReplaceDocument,
  findFirstFamilyIdByMemberUid,
  getDocument,
  listDocuments,
  nullField,
  readBoolean,
  readString,
  readStringArray,
  stringField,
  timestampField,
  integerField,
} from "@/lib/firestore/rest";
import {
  isFamilyRewardImageId,
  isValidFamilyRewardCoinCost,
  isValidFamilyRewardLimit,
  listFamilyRewards,
  MAX_FAMILY_REWARD_LIMIT,
  MAX_FAMILY_REWARD_DESCRIPTION_LENGTH,
  normalizeFamilyRewardCoinCost,
  normalizeFamilyRewardDescription,
  normalizeFamilyRewardLimit,
} from "@/lib/family/rewards";
import { trackAchievementEvent } from "@/lib/achievements/service";
import { submitFamilyRewardToCommunity } from "@/lib/community-awards";

type CreateRewardBody = {
  description?: unknown;
  coinCost?: unknown;
  imageId?: unknown;
  individualLimit?: unknown;
  familyLimit?: unknown;
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
          return {
            noFamily: true,
            viewerRole: "player" as ViewerRole,
            rewards: [],
          };
        }
        const [viewerRole, rewards] = await Promise.all([
          getViewerRole(familyId, session.uid, idToken),
          listFamilyRewards(familyId, idToken, 300, { includeDisabled: true }),
        ]);
        return {
          noFamily: false,
          viewerRole,
          rewards,
        };
      });

    const response = NextResponse.json(data);
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[FAMILY_REWARDS_GET_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "family_rewards_unavailable");
  }
}

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  let body: CreateRewardBody;
  try {
    body = (await request.json()) as CreateRewardBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const description =
    typeof body.description === "string" ? normalizeFamilyRewardDescription(body.description) : "";
  const coinCost = normalizeFamilyRewardCoinCost(body.coinCost);
  const imageId = typeof body.imageId === "string" ? body.imageId.trim() : "";
  const individualLimit = normalizeFamilyRewardLimit(body.individualLimit);
  const familyLimit = normalizeFamilyRewardLimit(body.familyLimit);
  const submitToCommunityAwards = body.submitToCommunityAwards === true;

  if (!description) {
    return NextResponse.json({ error: "description_required" }, { status: 400 });
  }
  if (description.length > MAX_FAMILY_REWARD_DESCRIPTION_LENGTH) {
    return NextResponse.json({ error: "description_too_long" }, { status: 400 });
  }
  if (!isValidFamilyRewardCoinCost(coinCost)) {
    return NextResponse.json({ error: "invalid_coin_cost" }, { status: 400 });
  }
  if (!isFamilyRewardImageId(imageId)) {
    return NextResponse.json({ error: "invalid_image_id" }, { status: 400 });
  }
  if (!isValidFamilyRewardLimit(individualLimit)) {
    return NextResponse.json(
      { error: "invalid_individual_limit", max: MAX_FAMILY_REWARD_LIMIT },
      { status: 400 },
    );
  }
  if (!isValidFamilyRewardLimit(familyLimit)) {
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

        const rewardId = randomUUID();
        const now = new Date().toISOString();
        await createOrReplaceDocument(
          `families/${familyId}/rewards/${rewardId}`,
          {
            description: stringField(description),
            coinCost: integerField(coinCost),
            imageId: stringField(imageId),
            individualLimit: integerField(individualLimit),
            familyLimit: integerField(familyLimit),
            familyRedeemedCount: integerField(0),
            disabled: boolField(false),
            deleted: boolField(false),
            submitToCommunityAwards: boolField(false),
            communityAwardSubmissionId: stringField(""),
            communityAwardSubmissionStatus: stringField(""),
            communityAwardSubmittedAt: nullField(),
            communityAwardReviewedAt: nullField(),
            communityAwardRejectionReason: stringField(""),
            createdBy: stringField(session.uid),
            createdAt: timestampField(now),
            updatedAt: timestampField(now),
          },
          idToken,
        );
        let communityAwardSubmissionId = "";
        let communityAwardSubmissionStatus = "";
        if (submitToCommunityAwards) {
          communityAwardSubmissionId = await submitFamilyRewardToCommunity({
            familyId,
            rewardId,
            submittedByUid: session.uid,
            submittedByEmail: session.email ?? "",
            description,
            coinCost,
            imageId,
            rewardCreatedAt: now,
          });
          communityAwardSubmissionStatus = "pending_review";
        }
        await trackAchievementEvent({
          uid: session.uid,
          familyId,
          idToken,
          viewerRole,
          eventId: `family_reward_create_${rewardId}`,
          metricDeltas: {
            admin_rewards_created: 1,
          },
        });

        return {
          kind: "ok" as const,
          reward: {
            id: rewardId,
            description,
            coinCost,
            imageId,
            individualLimit: individualLimit > 0 ? individualLimit : undefined,
            familyLimit: familyLimit > 0 ? familyLimit : undefined,
            familyRedeemedCount: undefined,
            disabled: false,
            submitToCommunityAwards,
            communityAwardSubmissionId: communityAwardSubmissionId || null,
            communityAwardSubmissionStatus: communityAwardSubmissionStatus || null,
            communityAwardSubmittedAt: submitToCommunityAwards ? now : null,
            communityAwardReviewedAt: null,
            communityAwardRejectionReason: null,
          },
        };
      });

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "forbidden_action") {
      return NextResponse.json({ error: "forbidden_action" }, { status: 403 });
    }

    const response = NextResponse.json({ reward: data.reward }, { status: 201 });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[FAMILY_REWARD_CREATE_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "create_family_reward_failed");
  }
}
