import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { applyWalletDelta, getPrimaryFamilyId, getWalletBalance } from "@/lib/economy/wallet";
import {
  getDocument,
  patchDocument,
  readInteger,
  readString,
  readStringArray,
  stringArrayField,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import {
  DEFAULT_AVATAR_IDS,
  STORE_CATEGORIES,
  findStoreCategoryById,
  findStoreOptionByValue,
  isAllowedDashboardColor,
  isStoreCategoryId,
  normalizeColor,
} from "@/lib/store/catalog";

type StoreActionBody = {
  action?: unknown;
  itemId?: unknown;
  categoryId?: unknown;
  optionId?: unknown;
  color?: unknown;
  avatarId?: unknown;
};

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

function resolveOwnedOptionIds(
  fields: Parameters<typeof readStringArray>[0],
) {
  const legacyOwnedCategoryIds = readStringArray(fields, "ownedStoreItemIds").filter(isStoreCategoryId);
  const ownedOptionIds = new Set(readStringArray(fields, "ownedStoreOptionIds"));
  for (const categoryId of legacyOwnedCategoryIds) {
    const legacyCategory = findStoreCategoryById(categoryId);
    if (!legacyCategory) {
      continue;
    }
    for (const option of legacyCategory.options) {
      ownedOptionIds.add(option.id);
    }
  }
  return ownedOptionIds;
}

async function getStoreSummary(uid: string, idToken: string) {
  const userDoc = await getDocument(`users/${uid}`, idToken);
  const familyId = readStringArray(userDoc.fields, "familyIds")[0] ?? "";
  const balance = Math.max(0, readInteger(userDoc.fields, "walletBalance"));
  const ownedOptionIds = resolveOwnedOptionIds(userDoc.fields);

  let dashboardPrimaryColor = "";
  let avatarId = "";
  const selectedConfettiOptionId = readString(userDoc.fields, "selectedConfettiOptionId");

  if (familyId) {
    try {
      const memberDoc = await getDocument(`families/${familyId}/members/${uid}`, idToken);
      dashboardPrimaryColor = normalizeColor(readString(memberDoc.fields, "dashboardPrimaryColor"));
      avatarId = readString(memberDoc.fields, "avatarId");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      if (!reason.includes("FIRESTORE_HTTP_404")) {
        throw error;
      }
    }
  }

  return {
    balance,
    familyId,
    ownedOptionIds: Array.from(ownedOptionIds),
    dashboardPrimaryColor,
    avatarId,
    selectedConfettiOptionId,
    categories: STORE_CATEGORIES,
    avatarOptions: DEFAULT_AVATAR_IDS,
  };
}

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  const brief = request.nextUrl.searchParams.get("brief") === "1";

  try {
    const { data, session: refreshedSession, refreshed } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        const summary = await getStoreSummary(session.uid, idToken);
        if (brief) {
          return { balance: summary.balance };
        }
        return summary;
      },
    );

    const response = NextResponse.json(data);
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[STORE_GET_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "store_unavailable");
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

  let body: StoreActionBody;
  try {
    body = (await request.json()) as StoreActionBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";

  try {
    const { data, session: refreshedSession, refreshed } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        if (action === "purchase_option") {
          const categoryId = typeof body.categoryId === "string" ? body.categoryId : "";
          const optionId = typeof body.optionId === "string" ? body.optionId : "";
          const category = findStoreCategoryById(categoryId);
          if (!category) {
            return { kind: "invalid_category" as const };
          }
          const option = category.options.find((entry) => entry.id === optionId);
          if (!option) {
            return { kind: "invalid_option" as const };
          }

          const userDoc = await getDocument(`users/${session.uid}`, idToken);
          const ownedOptionIds = resolveOwnedOptionIds(userDoc.fields);
          if (ownedOptionIds.has(option.id)) {
            return { kind: "already_owned" as const };
          }
          const balance = await getWalletBalance(session.uid, idToken);
          if (balance < category.price) {
            return { kind: "insufficient_funds" as const };
          }

          try {
            await applyWalletDelta({
              uid: session.uid,
              idToken,
              delta: -category.price,
              reason: "store_purchase",
              itemId: option.id,
            });
          } catch (error) {
            const reason = error instanceof Error ? error.message : "";
            if (reason.includes("WALLET_NEGATIVE_BLOCKED")) {
              return { kind: "insufficient_funds" as const };
            }
            throw error;
          }
          ownedOptionIds.add(option.id);
          await patchDocument(
            `users/${session.uid}`,
            {
              ownedStoreOptionIds: stringArrayField(Array.from(ownedOptionIds)),
              storeUpdatedAt: timestampField(new Date().toISOString()),
            },
            idToken,
            ["ownedStoreOptionIds", "storeUpdatedAt"],
          );
          return { kind: "ok" as const };
        }

        if (action === "set_color") {
          const color = typeof body.color === "string" ? normalizeColor(body.color) : "";
          if (!isAllowedDashboardColor(color)) {
            return { kind: "invalid_color" as const };
          }
          const colorOption = findStoreOptionByValue("customize_colors", color);
          if (!colorOption) {
            return { kind: "invalid_color" as const };
          }

          const userDoc = await getDocument(`users/${session.uid}`, idToken);
          const ownedOptionIds = resolveOwnedOptionIds(userDoc.fields);
          if (!ownedOptionIds.has(colorOption.id)) {
            return { kind: "missing_unlock" as const };
          }
          const familyId = await getPrimaryFamilyId(session.uid, idToken);
          if (!familyId) {
            return { kind: "family_not_found" as const };
          }
          await patchDocument(
            `families/${familyId}/members/${session.uid}`,
            {
              dashboardPrimaryColor: stringField(color),
              updatedAt: timestampField(new Date().toISOString()),
            },
            idToken,
            ["dashboardPrimaryColor", "updatedAt"],
          );
          return { kind: "ok" as const };
        }

        if (action === "set_avatar") {
          const avatarId = typeof body.avatarId === "string" ? body.avatarId.trim() : "";
          if (!DEFAULT_AVATAR_IDS.includes(avatarId)) {
            return { kind: "invalid_avatar" as const };
          }
          const avatarOption = findStoreOptionByValue("customize_avatar", avatarId);
          if (!avatarOption) {
            return { kind: "invalid_avatar" as const };
          }
          const userDoc = await getDocument(`users/${session.uid}`, idToken);
          const ownedOptionIds = resolveOwnedOptionIds(userDoc.fields);
          if (!ownedOptionIds.has(avatarOption.id)) {
            return { kind: "missing_unlock" as const };
          }
          const familyId = await getPrimaryFamilyId(session.uid, idToken);
          if (!familyId) {
            return { kind: "family_not_found" as const };
          }
          await patchDocument(
            `families/${familyId}/members/${session.uid}`,
            {
              avatarId: stringField(avatarId),
              updatedAt: timestampField(new Date().toISOString()),
            },
            idToken,
            ["avatarId", "updatedAt"],
          );
          return { kind: "ok" as const };
        }

        if (action === "set_confetti") {
          const optionId = typeof body.optionId === "string" ? body.optionId.trim() : "";
          const category = findStoreCategoryById("victory_confetti");
          const confettiOption = category?.options.find((entry) => entry.id === optionId) ?? null;
          if (!confettiOption) {
            return { kind: "invalid_option" as const };
          }
          const userDoc = await getDocument(`users/${session.uid}`, idToken);
          const ownedOptionIds = resolveOwnedOptionIds(userDoc.fields);
          if (!ownedOptionIds.has(confettiOption.id)) {
            return { kind: "missing_unlock" as const };
          }
          await patchDocument(
            `users/${session.uid}`,
            {
              selectedConfettiOptionId: stringField(confettiOption.id),
              storeUpdatedAt: timestampField(new Date().toISOString()),
            },
            idToken,
            ["selectedConfettiOptionId", "storeUpdatedAt"],
          );
          return { kind: "ok" as const };
        }

        return { kind: "invalid_action" as const };
      },
    );

    if (data.kind === "invalid_action") {
      return NextResponse.json({ error: "invalid_action" }, { status: 400 });
    }
    if (data.kind === "invalid_category") {
      return NextResponse.json({ error: "invalid_category" }, { status: 400 });
    }
    if (data.kind === "invalid_option") {
      return NextResponse.json({ error: "invalid_option" }, { status: 400 });
    }
    if (data.kind === "invalid_color") {
      return NextResponse.json({ error: "invalid_color" }, { status: 400 });
    }
    if (data.kind === "invalid_avatar") {
      return NextResponse.json({ error: "invalid_avatar" }, { status: 400 });
    }
    if (data.kind === "already_owned") {
      return NextResponse.json({ error: "already_owned" }, { status: 409 });
    }
    if (data.kind === "insufficient_funds") {
      return NextResponse.json({ error: "insufficient_funds" }, { status: 409 });
    }
    if (data.kind === "missing_unlock") {
      return NextResponse.json({ error: "missing_unlock" }, { status: 403 });
    }
    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }

    const response = NextResponse.json({ success: true });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[STORE_POST_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "store_update_failed");
  }
}
