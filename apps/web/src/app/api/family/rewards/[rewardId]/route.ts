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
  isFamilyRewardImageId,
  isValidFamilyRewardCoinCost,
  MAX_FAMILY_REWARD_DESCRIPTION_LENGTH,
  normalizeFamilyRewardCoinCost,
  normalizeFamilyRewardDescription,
} from "@/lib/family/rewards";

type UpdateRewardBody = {
  description?: unknown;
  coinCost?: unknown;
  imageId?: unknown;
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
  if (!hasDescription && !hasCoinCost && !hasImageId) {
    return NextResponse.json({ error: "update_values_required" }, { status: 400 });
  }

  const description = hasDescription ? normalizeFamilyRewardDescription(String(body.description)) : "";
  const coinCost = hasCoinCost ? normalizeFamilyRewardCoinCost(body.coinCost) : 0;
  const imageId = hasImageId ? String(body.imageId).trim() : "";

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

        const nextDescription = hasDescription ? description : existingDescription;
        const nextCoinCost = hasCoinCost ? coinCost : existingCoinCost;
        const nextImageId = hasImageId ? imageId : existingImageId;

        if (!nextDescription) {
          return { kind: "description_required" as const };
        }
        if (!isValidFamilyRewardCoinCost(nextCoinCost)) {
          return { kind: "invalid_coin_cost" as const };
        }
        if (!isFamilyRewardImageId(nextImageId)) {
          return { kind: "invalid_image_id" as const };
        }

        const now = new Date().toISOString();
        await patchDocument(
          `families/${familyId}/rewards/${rewardId}`,
          {
            description: stringField(nextDescription),
            coinCost: integerField(nextCoinCost),
            imageId: stringField(nextImageId),
            updatedAt: timestampField(now),
          },
          idToken,
          ["description", "coinCost", "imageId", "updatedAt"],
        );

        return {
          kind: "ok" as const,
          reward: {
            id: rewardId,
            description: nextDescription,
            coinCost: nextCoinCost,
            imageId: nextImageId,
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
