import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { randomUUID } from "node:crypto";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import type { SessionUser } from "@/lib/auth/session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { applyWalletDelta, getPrimaryFamilyId, getWalletBalance } from "@/lib/economy/wallet";
import {
  createOrReplaceDocument,
  listDocuments,
  getDocument,
  patchDocument,
  findFirstFamilyIdByMemberUid,
  integerField,
  readTimestamp,
  readInteger,
  readBoolean,
  readString,
  readStringArray,
  stringArrayField,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import {
  DEFAULT_COLOR_THEME_OPTION_ID,
  DEFAULT_CONFETTI_OPTION_ID,
  DEFAULT_AVATAR_IDS,
  STORE_CATEGORIES,
  findConfettiOptionById,
  findColorThemeOptionById,
  findStoreCategoryById,
  findStoreOptionByValue,
  isAllowedDashboardColor,
  isStoreCategoryId,
  normalizeColor,
  normalizeThemePalette,
  type StoreCategory,
} from "@/lib/store/catalog";
import { listFamilyAwardClaims } from "@/lib/family/award-claims";
import { listFamilyRewards, type FamilyReward } from "@/lib/family/rewards";
import { emitFamilyActivity } from "@/lib/notifications/events";
import { publishFamilyActivity } from "@/lib/ws/publish-family-activity";
import { trackAchievementEvent } from "@/lib/achievements/service";
import { buildOwnedItemsSummary } from "@/lib/items/owned-items";

type StoreActionBody = {
  action?: unknown;
  itemId?: unknown;
  categoryId?: unknown;
  optionId?: unknown;
  themeOptionId?: unknown;
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
function resolveSessionPictureFromStoreSummary(
  summary: {
    avatarId?: string;
    avatarPhotoUrl?: string;
    googlePhotoUrl?: string;
  },
  fallbackPicture: string,
) {
  const avatarId = summary.avatarId?.trim() ?? "";
  if (avatarId) {
    return `/avatars/default/${encodeURIComponent(avatarId)}`;
  }
  const avatarPhotoUrl = summary.avatarPhotoUrl?.trim() ?? "";
  if (avatarPhotoUrl) {
    return avatarPhotoUrl;
  }
  const googlePhotoUrl = summary.googlePhotoUrl?.trim() ?? "";
  if (googlePhotoUrl) {
    return googlePhotoUrl;
  }
  return fallbackPicture;
}

function resolveOwnedOptionIds(
  fields: Parameters<typeof readStringArray>[0],
) {
  const legacyOwnedCategoryIds = readStringArray(fields, "ownedStoreItemIds").filter(isStoreCategoryId);
  const ownedOptionIds = new Set(readStringArray(fields, "ownedStoreOptionIds"));
  // All players start with the first color theme unlocked by default.
  ownedOptionIds.add(DEFAULT_COLOR_THEME_OPTION_ID);
  // All players start with the no-confetti option unlocked.
  ownedOptionIds.add(DEFAULT_CONFETTI_OPTION_ID);
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

function grantOwnedOptionIdsFromInventory(input: {
  ownedOptionIds: Set<string>;
  inventoryByItemId: Map<string, { quantity: number }>;
}) {
  const avatarCategory = findStoreCategoryById("customize_avatar");
  if (!avatarCategory) {
    return;
  }
  for (const option of avatarCategory.options) {
    const unlockItemId = option.itemId?.trim() ?? "";
    if (!unlockItemId) {
      continue;
    }
    const quantity = input.inventoryByItemId.get(unlockItemId)?.quantity ?? 0;
    if (quantity > 0) {
      input.ownedOptionIds.add(option.id);
    }
  }
}

function toUnixMillis(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function buildFamilyAwardsCategory(rewards: Awaited<ReturnType<typeof listFamilyRewards>>): StoreCategory {
  return {
    id: "family_awards",
    name: "Family Awards",
    description: "Redeem custom family rewards.",
    price: 0,
    imagePath: "/store3/family-rewards.png",
    kind: "reward",
    options: rewards.map((reward) => ({
      id: reward.id,
      label: reward.description,
      value: reward.imageId,
      price: reward.coinCost,
    })),
  };
}

type RewardAvailability = {
  rewards: FamilyReward[];
  availableRewards: FamilyReward[];
};

async function resolveAvailableFamilyRewards(
  familyId: string,
  viewerUid: string,
  idToken: string,
  rewardsInput?: FamilyReward[],
): Promise<RewardAvailability> {
  const rewards = rewardsInput ?? await listFamilyRewards(familyId, idToken);
  if (rewards.length === 0) {
    return { rewards, availableRewards: rewards };
  }

  const rewardIds = new Set(rewards.map((reward) => reward.id));
  const viewerCountByRewardId = new Map<string, number>();
  const familyCountByRewardId = new Map<string, number>();

  try {
    const awardClaims = await listFamilyAwardClaims(familyId, idToken);
    for (const claim of awardClaims) {
      if (claim.status !== "unclaimed" || !rewardIds.has(claim.rewardId)) {
        continue;
      }
      familyCountByRewardId.set(claim.rewardId, (familyCountByRewardId.get(claim.rewardId) ?? 0) + 1);
      if (claim.purchaserUid === viewerUid) {
        viewerCountByRewardId.set(claim.rewardId, (viewerCountByRewardId.get(claim.rewardId) ?? 0) + 1);
      }
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_HTTP_404")) {
      throw error;
    }
  }

  const availableRewards = rewards.filter((reward) => {
    const viewerCount = viewerCountByRewardId.get(reward.id) ?? 0;
    const familyCount = familyCountByRewardId.get(reward.id) ?? 0;
    if (reward.individualLimit && viewerCount >= reward.individualLimit) {
      return false;
    }
    if (reward.familyLimit && familyCount >= reward.familyLimit) {
      return false;
    }
    return true;
  });

  return { rewards, availableRewards };
}

async function getPrimaryFamilyIdWithFallback(uid: string, idToken: string) {
  try {
    const userDoc = await getDocument(`users/${uid}`, idToken);
    const fromUser = readStringArray(userDoc.fields, "familyIds")[0] ?? "";
    if (fromUser) {
      return fromUser;
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_HTTP_404")) {
      throw error;
    }
  }

  return findFirstFamilyIdByMemberUid(uid, idToken);
}

function buildStoreUserDocFromSession(
  session: SessionUser,
): Awaited<ReturnType<typeof getDocument>> {
  return {
    name: `users/${session.uid}`,
    fields: {
      uid: stringField(session.uid),
      role: stringField(session.role || "player"),
      email: stringField(session.email || ""),
      displayName: stringField(session.name || session.email || "Family member"),
      photoUrl: stringField(session.picture || ""),
      locale: stringField(session.locale || "en-US"),
      familyIds: stringArrayField([]),
      walletBalance: integerField(0),
      ownedStoreOptionIds: stringArrayField([
        DEFAULT_COLOR_THEME_OPTION_ID,
        DEFAULT_CONFETTI_OPTION_ID,
      ]),
      selectedConfettiOptionId: stringField(DEFAULT_CONFETTI_OPTION_ID),
    },
  };
}

async function getStoreUserDoc(
  session: SessionUser,
  idToken: string,
): Promise<Awaited<ReturnType<typeof getDocument>>> {
  try {
    return await getDocument(`users/${session.uid}`, idToken);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_HTTP_404")) {
      throw error;
    }
  }

  return buildStoreUserDocFromSession(session);
}

async function getViewerRoleForFamily(familyId: string, uid: string, idToken: string) {
  try {
    const memberDoc = await getDocument(`families/${familyId}/members/${uid}`, idToken);
    if (readBoolean(memberDoc.fields, "deleted")) {
      return "player" as const;
    }
    return readString(memberDoc.fields, "role") === "admin" ? ("admin" as const) : ("player" as const);
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
    return "player" as const;
  }
  return readString(memberByUid.fields, "role") === "admin" ? ("admin" as const) : ("player" as const);
}

async function getStoreSummary(session: SessionUser, memberId: string, idToken: string) {
  const uid = session.uid;
  const userDoc = await getStoreUserDoc(session, idToken);
  const fallbackFamilyId = await getPrimaryFamilyIdWithFallback(uid, idToken);
  const familyId = readStringArray(userDoc.fields, "familyIds")[0] ?? fallbackFamilyId;
  const balance = Math.max(0, readInteger(userDoc.fields, "walletBalance"));
  const ownedOptionIds = resolveOwnedOptionIds(userDoc.fields);

  let dashboardPrimaryColor = "";
  let avatarId = "";
  let avatarPhotoUrl = "";
  const googlePhotoUrl = readString(userDoc.fields, "photoUrl");
  let selectedConfettiOptionId = readString(userDoc.fields, "selectedConfettiOptionId").trim();
  let memberSelectedConfettiOptionId = "";
  let themeOptionId = readString(userDoc.fields, "preferencesThemeOptionId").trim();
  let themePrimaryColor = normalizeColor(readString(userDoc.fields, "preferencesThemePrimaryColor"));
  let themeSecondaryColor = normalizeColor(readString(userDoc.fields, "preferencesThemeSecondaryColor"));
  let themeTertiaryColor = normalizeColor(readString(userDoc.fields, "preferencesThemeTertiaryColor"));
  let viewerRole: "admin" | "player" = "player";

  if (familyId) {
    viewerRole = await getViewerRoleForFamily(familyId, uid, idToken);
    for (const candidateMemberId of [memberId, uid].filter(Boolean)) {
      try {
        const memberDoc = await getDocument(`families/${familyId}/members/${candidateMemberId}`, idToken);
        dashboardPrimaryColor = normalizeColor(readString(memberDoc.fields, "dashboardPrimaryColor"));
        avatarId = readString(memberDoc.fields, "avatarId");
        avatarPhotoUrl = readString(memberDoc.fields, "avatarPhotoUrl");
        memberSelectedConfettiOptionId = readString(memberDoc.fields, "selectedConfettiOptionId").trim();
        break;
      } catch (error) {
        const reason = error instanceof Error ? error.message : "";
        if (!reason.includes("FIRESTORE_HTTP_404")) {
          throw error;
        }
      }
    }
  }

  const resolvedThemeOption = themeOptionId ? findColorThemeOptionById(themeOptionId) : null;
  if (resolvedThemeOption?.theme) {
    const normalizedPalette = normalizeThemePalette(resolvedThemeOption.theme);
    themePrimaryColor = isAllowedDashboardColor(themePrimaryColor)
      ? themePrimaryColor
      : normalizedPalette.primary;
    themeSecondaryColor = isAllowedDashboardColor(themeSecondaryColor)
      ? themeSecondaryColor
      : normalizedPalette.secondary;
    themeTertiaryColor = isAllowedDashboardColor(themeTertiaryColor)
      ? themeTertiaryColor
      : normalizedPalette.tertiary;
  } else if (dashboardPrimaryColor) {
    const colorOption = findStoreOptionByValue("customize_colors", dashboardPrimaryColor);
    if (colorOption?.theme) {
      const normalizedPalette = normalizeThemePalette(colorOption.theme);
      themeOptionId = colorOption.id;
      themePrimaryColor = normalizedPalette.primary;
      themeSecondaryColor = normalizedPalette.secondary;
      themeTertiaryColor = normalizedPalette.tertiary;
    }
  }

  const effectiveConfettiOptionId = memberSelectedConfettiOptionId || selectedConfettiOptionId;
  const selectedConfettiOption = effectiveConfettiOptionId
    ? findConfettiOptionById(effectiveConfettiOptionId)
    : null;
  if (!selectedConfettiOption || !ownedOptionIds.has(selectedConfettiOption.id)) {
    selectedConfettiOptionId = DEFAULT_CONFETTI_OPTION_ID;
  } else {
    selectedConfettiOptionId = selectedConfettiOption.id;
    if (selectedConfettiOptionId !== readString(userDoc.fields, "selectedConfettiOptionId").trim()) {
      await patchDocument(
        `users/${uid}`,
        {
          selectedConfettiOptionId: stringField(selectedConfettiOptionId),
          storeUpdatedAt: timestampField(new Date().toISOString()),
        },
        idToken,
        ["selectedConfettiOptionId", "storeUpdatedAt"],
      );
    }
  }

  const unlockedOptionDates: Record<string, string> = {};
  const questItemQuantities: Record<string, number> = {};
  const inventoryByItemId = new Map<string, { quantity: number }>();
  try {
    const ledgerDocs = await listDocuments(`users/${uid}/walletLedger`, idToken, 500);
    for (const doc of ledgerDocs) {
      if (readString(doc.fields, "reason") !== "store_purchase") {
        continue;
      }
      const optionId = readString(doc.fields, "itemId");
      if (!optionId || !ownedOptionIds.has(optionId)) {
        continue;
      }
      const createdAt = readTimestamp(doc.fields, "createdAt");
      if (!createdAt) {
        continue;
      }
      const existing = unlockedOptionDates[optionId];
      if (!existing || toUnixMillis(createdAt) < toUnixMillis(existing)) {
        unlockedOptionDates[optionId] = createdAt;
      }
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_HTTP_404")) {
      throw error;
    }
  }
  try {
    const inventoryDocs = await listDocuments(`users/${uid}/inventory`, idToken, 500);
    for (const doc of inventoryDocs) {
      const itemId = readString(doc.fields, "itemId");
      if (!itemId) {
        continue;
      }
      const quantity = Math.max(0, readInteger(doc.fields, "quantity"));
      questItemQuantities[itemId] = quantity;
      inventoryByItemId.set(itemId, { quantity });
    }
    grantOwnedOptionIdsFromInventory({ ownedOptionIds, inventoryByItemId });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_HTTP_404")) {
      throw error;
    }
  }

  const familyRewardAvailability = familyId
    ? await resolveAvailableFamilyRewards(familyId, uid, idToken)
    : { rewards: [], availableRewards: [] };
  const familyAwardsCategory = buildFamilyAwardsCategory(familyRewardAvailability.availableRewards);
  const ownedItems = buildOwnedItemsSummary({
    ownedOptionIds,
    inventoryByItemId,
  });

  return {
    balance,
    familyId,
    viewerRole,
    ownedOptionIds: Array.from(ownedOptionIds),
    dashboardPrimaryColor,
    themeOptionId,
    themePrimaryColor,
    themeSecondaryColor,
    themeTertiaryColor,
    avatarId,
    avatarPhotoUrl,
    googlePhotoUrl,
    unlockedOptionDates,
    selectedConfettiOptionId,
    questItemQuantities,
    ownedItems,
    categories: [familyAwardsCategory, ...STORE_CATEGORIES],
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
  const uid = session.uid;

  const brief = request.nextUrl.searchParams.get("brief") === "1";

  try {
    const { data, session: refreshedSession, refreshed } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        const summary = await getStoreSummary(session, session.memberId || uid, idToken);
        if (brief) {
          return {
            balance: summary.balance,
            selectedConfettiOptionId: summary.selectedConfettiOptionId,
          };
        }
        return summary;
      },
    );

    let nextSession = refreshedSession;
    let shouldSetSessionCookie = refreshed;
    if (!brief) {
      const summary = data as {
        avatarId?: unknown;
        avatarPhotoUrl?: unknown;
        googlePhotoUrl?: unknown;
      };
      const resolvedPicture = resolveSessionPictureFromStoreSummary(
        {
          avatarId: typeof summary.avatarId === "string" ? summary.avatarId : "",
          avatarPhotoUrl: typeof summary.avatarPhotoUrl === "string" ? summary.avatarPhotoUrl : "",
          googlePhotoUrl: typeof summary.googlePhotoUrl === "string" ? summary.googlePhotoUrl : "",
        },
        refreshedSession.picture,
      );
      if (resolvedPicture !== refreshedSession.picture) {
        nextSession = { ...refreshedSession, picture: resolvedPicture };
        shouldSetSessionCookie = true;
      }
    }

    const response = NextResponse.json(data);
    if (shouldSetSessionCookie) {
      setSessionUserCookie(response, nextSession);
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
  const uid = session.uid;
  const currentMemberId = session.memberId || uid;

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
        async function applyOwnedThemeOption(optionId: string, ownedOptionIds: Set<string>) {
          const themeOption = findColorThemeOptionById(optionId);
          if (!themeOption || !themeOption.theme) {
            return { kind: "invalid_theme_option" as const };
          }
          if (!ownedOptionIds.has(themeOption.id)) {
            return { kind: "missing_unlock" as const };
          }
          const familyId = await getPrimaryFamilyId(uid, idToken);
          if (!familyId) {
            return { kind: "family_not_found" as const };
          }
          const now = new Date().toISOString();
          const palette = normalizeThemePalette(themeOption.theme);
          await patchDocument(
            `families/${familyId}/members/${uid}`,
            {
              dashboardPrimaryColor: stringField(palette.primary),
              updatedAt: timestampField(now),
            },
            idToken,
            ["dashboardPrimaryColor", "updatedAt"],
          );
          await patchDocument(
            `users/${uid}`,
            {
              preferencesThemeOptionId: stringField(themeOption.id),
              preferencesThemePrimaryColor: stringField(palette.primary),
              preferencesThemeSecondaryColor: stringField(palette.secondary),
              preferencesThemeTertiaryColor: stringField(palette.tertiary),
              preferencesUpdatedAt: timestampField(now),
              storeUpdatedAt: timestampField(now),
            },
            idToken,
            [
              "preferencesThemeOptionId",
              "preferencesThemePrimaryColor",
              "preferencesThemeSecondaryColor",
              "preferencesThemeTertiaryColor",
              "preferencesUpdatedAt",
              "storeUpdatedAt",
            ],
          );
          await publishFamilyActivity({
            type: "theme_changed",
            familyId,
            occurredAt: now,
          });
          await trackAchievementEvent({
            uid,
            familyId,
            idToken,
            viewerRole: "player",
            eventId: `store_set_theme_${themeOption.id}`,
            metricDeltas: {
              themes_applied: 1,
            },
            profileCustomizationKey: "theme",
          });
          return { kind: "ok" as const };
        }

        async function applyOwnedAvatarOption(avatarId: string, ownedOptionIds: Set<string>) {
          if (!DEFAULT_AVATAR_IDS.includes(avatarId)) {
            return { kind: "invalid_avatar" as const };
          }
          const avatarOption = findStoreOptionByValue("customize_avatar", avatarId);
          if (!avatarOption) {
            return { kind: "invalid_avatar" as const };
          }
          if (avatarOption.itemId?.trim()) {
            try {
              const inventoryDoc = await getDocument(`users/${uid}/inventory/${avatarOption.itemId.trim()}`, idToken);
              const quantity = Math.max(0, readInteger(inventoryDoc.fields, "quantity"));
              if (quantity > 0) {
                ownedOptionIds.add(avatarOption.id);
              }
            } catch (error) {
              const reason = error instanceof Error ? error.message : "";
              if (!reason.includes("FIRESTORE_HTTP_404")) {
                throw error;
              }
            }
          }
          if (!ownedOptionIds.has(avatarOption.id)) {
            return { kind: "missing_unlock" as const };
          }
          const familyId = await getPrimaryFamilyId(uid, idToken);
          if (!familyId) {
            return { kind: "family_not_found" as const };
          }
          const now = new Date().toISOString();
          const memberDocId = currentMemberId;
          await patchDocument(
            `families/${familyId}/members/${memberDocId}`,
            {
              avatarId: stringField(avatarId),
              avatarPhotoUrl: stringField(""),
              updatedAt: timestampField(now),
            },
            idToken,
            ["avatarId", "avatarPhotoUrl", "updatedAt"],
          );
          await patchDocument(
            `users/${uid}`,
            {
              storeUpdatedAt: timestampField(now),
            },
            idToken,
            ["storeUpdatedAt"],
          );
          await publishFamilyActivity({
            type: "avatar_changed",
            familyId,
            occurredAt: now,
          });
          await trackAchievementEvent({
            uid,
            familyId,
            idToken,
            viewerRole: "player",
            eventId: `store_set_avatar_${avatarId}`,
            metricDeltas: {
              avatars_applied: 1,
            },
            profileCustomizationKey: "avatar",
          });
          return {
            kind: "ok" as const,
            nextPicture: `/avatars/default/${encodeURIComponent(avatarId)}`,
          };
        }

        async function applyGoogleAvatar(googleAvatarUrl: string) {
          const normalizedUrl = googleAvatarUrl.trim();
          if (!normalizedUrl) {
            return { kind: "google_avatar_unavailable" as const };
          }
          const familyId = await getPrimaryFamilyId(uid, idToken);
          if (!familyId) {
            return { kind: "family_not_found" as const };
          }
          const now = new Date().toISOString();
          const memberDocId = currentMemberId;
          await patchDocument(
            `families/${familyId}/members/${memberDocId}`,
            {
              avatarId: stringField(""),
              avatarPhotoUrl: stringField(normalizedUrl),
              updatedAt: timestampField(now),
            },
            idToken,
            ["avatarId", "avatarPhotoUrl", "updatedAt"],
          );
          await patchDocument(
            `users/${uid}`,
            {
              storeUpdatedAt: timestampField(now),
            },
            idToken,
            ["storeUpdatedAt"],
          );
          await publishFamilyActivity({
            type: "avatar_changed",
            familyId,
            occurredAt: now,
          });
          await trackAchievementEvent({
            uid,
            familyId,
            idToken,
            viewerRole: "player",
            eventId: "store_set_google_avatar",
            metricDeltas: {
              avatars_applied: 1,
            },
            profileCustomizationKey: "avatar",
          });
          return { kind: "ok" as const, nextPicture: normalizedUrl };
        }

        if (action === "purchase_option") {
          const categoryId = typeof body.categoryId === "string" ? body.categoryId.trim() : "";
          const optionId = typeof body.optionId === "string" ? body.optionId.trim() : "";
          console.log("[STORE_PURCHASE_ATTEMPT]", {
            uid,
            authUid: session.authUid || session.uid,
            switched: Boolean(session.authUid && session.authUid !== session.uid),
            categoryId,
            optionId,
          });

          let category = findStoreCategoryById(categoryId);
          let option = category?.options.find((entry) => entry.id === optionId) ?? null;

          if (!category && categoryId === "family_awards") {
            const familyId = await getPrimaryFamilyIdWithFallback(uid, idToken);
            if (!familyId) {
              return { kind: "family_not_found" as const };
            }
            const familyRewardAvailability = await resolveAvailableFamilyRewards(familyId, uid, idToken);
            const rewardExists = familyRewardAvailability.rewards.some((reward) => reward.id === optionId);
            category = buildFamilyAwardsCategory(familyRewardAvailability.availableRewards);
            option = category.options.find((entry) => entry.id === optionId) ?? null;
            if (!option && rewardExists) {
              return { kind: "reward_limit_reached" as const };
            }
          }

          if (!category) {
            return { kind: "invalid_category" as const };
          }
          if (!option) {
            return { kind: "invalid_option" as const };
          }
          if (option.isPurchasable === false) {
            return { kind: "invalid_option" as const };
          }

          const optionPrice = Math.max(0, Math.floor(option.price ?? category.price));
          const userDoc = await getDocument(`users/${uid}`, idToken);
          const ownedOptionIds = resolveOwnedOptionIds(userDoc.fields);
          if (category.kind !== "reward" && category.kind !== "quest_item" && ownedOptionIds.has(option.id)) {
            return { kind: "already_owned" as const };
          }
          let questItemQuantity = 0;
          let questItemTotalAcquired = 0;
          let questItemTotalConsumed = 0;
          if (category.kind === "quest_item") {
            const itemId = option.itemId?.trim() || option.id;
            try {
              const inventoryDoc = await getDocument(`users/${uid}/inventory/${itemId}`, idToken);
              questItemQuantity = Math.max(0, readInteger(inventoryDoc.fields, "quantity"));
              questItemTotalAcquired = Math.max(0, readInteger(inventoryDoc.fields, "totalAcquired"));
              questItemTotalConsumed = Math.max(0, readInteger(inventoryDoc.fields, "totalConsumed"));
            } catch (error) {
              const reason = error instanceof Error ? error.message : "";
              if (!reason.includes("FIRESTORE_HTTP_404")) {
                throw error;
              }
            }
            if (option.itemStackable !== true && questItemQuantity > 0) {
              return { kind: "already_owned" as const };
            }
          }
          if (category.kind === "avatar" && option.itemId?.trim()) {
            try {
              const inventoryDoc = await getDocument(`users/${uid}/inventory/${option.itemId.trim()}`, idToken);
              if (Math.max(0, readInteger(inventoryDoc.fields, "quantity")) > 0) {
                return { kind: "already_owned" as const };
              }
            } catch (error) {
              const reason = error instanceof Error ? error.message : "";
              if (!reason.includes("FIRESTORE_HTTP_404")) {
                throw error;
              }
            }
          }

          const balance = await getWalletBalance(uid, idToken);
          if (balance < optionPrice) {
            return { kind: "insufficient_funds" as const };
          }

          try {
            await applyWalletDelta({
              uid,
              idToken,
              delta: -optionPrice,
              reason: "store_purchase",
              itemId: option.id,
            });
          } catch (error) {
            const reason = error instanceof Error ? error.message : "";
            console.error("[STORE_PURCHASE_WALLET_ERROR]", {
              uid,
              categoryId,
              optionId: option.id,
              reason: reason.slice(0, 220),
            });
            if (reason.includes("WALLET_NEGATIVE_BLOCKED")) {
              return { kind: "insufficient_funds" as const };
            }
            throw error;
          }

          if (category.kind === "reward") {
            const familyId = await getPrimaryFamilyIdWithFallback(uid, idToken);
            console.log("[STORE_PURCHASE_REWARD_CONTEXT]", {
              uid,
              categoryId,
              optionId: option.id,
              familyId: familyId || "(missing)",
            });
            if (!familyId) {
              return { kind: "family_not_found" as const };
            }
            const now = new Date().toISOString();
            const awardClaimId = randomUUID();
            try {
              await createOrReplaceDocument(
                `families/${familyId}/awardClaims/${awardClaimId}`,
                {
                  rewardId: stringField(option.id),
                  rewardDescription: stringField(option.label),
                  rewardImageId: stringField(option.value),
                  coinCost: integerField(optionPrice),
                  purchaserUid: stringField(uid),
                  purchaserName: stringField(session.name || session.email || "Family member"),
                  purchaserEmail: stringField(session.email || ""),
                  purchasedAt: timestampField(now),
                  status: stringField("unclaimed"),
                  claimedByUid: stringField(""),
                  claimedByName: stringField(""),
                  createdAt: timestampField(now),
                  updatedAt: timestampField(now),
                },
                idToken,
              );
            } catch (error) {
              const reason = error instanceof Error ? error.message : "";
              console.error("[STORE_PURCHASE_AWARD_CLAIM_ERROR]", {
                uid,
                familyId,
                awardClaimId,
                optionId: option.id,
                reason: reason.slice(0, 220),
              });
              throw error;
            }
            try {
              await emitFamilyActivity({
                familyId,
                idToken,
                kind: "reward_claimed",
                actorUid: session.uid,
                actorEmail: session.email,
                actorName: session.name || session.email || "Family member",
                title: "Prize claimed",
                message: `${session.name || "Someone"} claimed "${option.label}" for ${optionPrice} coins.`,
                relatedIds: [session.uid, session.email],
                pushType: "reward_claimed",
              });
            } catch (error) {
              const reason = error instanceof Error ? error.message : "";
              console.error("[STORE_PURCHASE_ACTIVITY_ERROR]", {
                uid,
                familyId,
                optionId: option.id,
                reason: reason.slice(0, 220),
              });
              throw error;
            }
            await trackAchievementEvent({
              uid,
              familyId,
              idToken,
              viewerRole: "player",
              eventId: `store_purchase_reward_${option.id}_${awardClaimId}`,
              metricDeltas: {
                store_purchases: 1,
                family_awards_redeemed: 1,
              },
            });
            return { kind: "ok" as const };
          }

          if (category.kind === "quest_item") {
            const itemId = option.itemId?.trim() || option.id;
            const now = new Date().toISOString();

            await createOrReplaceDocument(
              `users/${uid}/inventory/${itemId}`,
              {
                itemId: stringField(itemId),
                quantity: integerField(questItemQuantity + 1),
                totalAcquired: integerField(questItemTotalAcquired + 1),
                totalConsumed: integerField(questItemTotalConsumed),
                updatedAt: timestampField(now),
              },
              idToken,
            );

            const familyIdForQuestItemPurchase = await getPrimaryFamilyIdWithFallback(uid, idToken);
            if (familyIdForQuestItemPurchase) {
              const questItemOptionIds = new Set(category.options.map((entry) => entry.itemId?.trim() || entry.id));
              const unlockedQuestItemIds = new Set<string>();
              try {
                const inventoryDocs = await listDocuments(`users/${uid}/inventory`, idToken, 500);
                for (const doc of inventoryDocs) {
                  const unlockedItemId = readString(doc.fields, "itemId").trim();
                  if (!unlockedItemId || !questItemOptionIds.has(unlockedItemId)) {
                    continue;
                  }
                  if (Math.max(0, readInteger(doc.fields, "quantity")) > 0) {
                    unlockedQuestItemIds.add(unlockedItemId);
                  }
                }
              } catch (error) {
                const reason = error instanceof Error ? error.message : "";
                if (!reason.includes("FIRESTORE_HTTP_404")) {
                  throw error;
                }
              }
              // Include current purchase in case inventory listing lags.
              unlockedQuestItemIds.add(itemId);
              await trackAchievementEvent({
                uid,
                familyId: familyIdForQuestItemPurchase,
                idToken,
                viewerRole: "player",
                eventId: `store_purchase_quest_item_${itemId}_${now}`,
                metricDeltas: {
                  store_purchases: 1,
                  store_quest_item_unlocks: 1,
                },
                metricMaximums: {
                  store_quest_item_collection_complete:
                    unlockedQuestItemIds.size >= questItemOptionIds.size && questItemOptionIds.size > 0
                      ? 1
                      : 0,
                },
              });
            }
            return { kind: "ok" as const };
          }

          const categoryPurchasableOptionIds = category.options
            .filter((entry) => !entry.isDefault)
            .map((entry) => entry.id);
          const ownedBeforeCount = categoryPurchasableOptionIds.filter((optionId) => ownedOptionIds.has(optionId)).length;
          ownedOptionIds.add(option.id);
          const ownedAfterCount = categoryPurchasableOptionIds.filter((optionId) => ownedOptionIds.has(optionId)).length;
          const unlockDeltas: Record<string, number> = {};
          const unlockMaximums: Record<string, number> = {};
          if (category.kind === "color") {
            if (ownedBeforeCount === 0 && ownedAfterCount > 0) {
              unlockDeltas.store_color_unlocks = 1;
            }
            if (categoryPurchasableOptionIds.length > 0 && ownedAfterCount >= categoryPurchasableOptionIds.length) {
              unlockMaximums.store_color_collection_complete = 1;
            }
          } else if (category.kind === "avatar") {
            if (ownedBeforeCount === 0 && ownedAfterCount > 0) {
              unlockDeltas.store_avatar_unlocks = 1;
            }
            if (categoryPurchasableOptionIds.length > 0 && ownedAfterCount >= categoryPurchasableOptionIds.length) {
              unlockMaximums.store_avatar_collection_complete = 1;
            }
          } else if (category.kind === "confetti") {
            if (ownedBeforeCount === 0 && ownedAfterCount > 0) {
              unlockDeltas.store_confetti_unlocks = 1;
            }
            if (categoryPurchasableOptionIds.length > 0 && ownedAfterCount >= categoryPurchasableOptionIds.length) {
              unlockMaximums.store_confetti_collection_complete = 1;
            }
          }
          await patchDocument(
            `users/${uid}`,
            {
              ownedStoreOptionIds: stringArrayField(Array.from(ownedOptionIds)),
              storeUpdatedAt: timestampField(new Date().toISOString()),
            },
            idToken,
            ["ownedStoreOptionIds", "storeUpdatedAt"],
          );
          const familyIdForPurchase = await getPrimaryFamilyIdWithFallback(uid, idToken);
          if (familyIdForPurchase) {
            await trackAchievementEvent({
              uid,
              familyId: familyIdForPurchase,
              idToken,
              viewerRole: "player",
              eventId: `store_purchase_option_${option.id}`,
              metricDeltas: {
                store_purchases: 1,
                ...unlockDeltas,
              },
              metricMaximums: unlockMaximums,
            });
          }
          if (category.kind === "avatar") {
            return applyOwnedAvatarOption(option.value, ownedOptionIds);
          }
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

          const userDoc = await getDocument(`users/${uid}`, idToken);
          const ownedOptionIds = resolveOwnedOptionIds(userDoc.fields);
          return applyOwnedThemeOption(colorOption.id, ownedOptionIds);
        }

        if (action === "set_theme") {
          const optionId = typeof body.optionId === "string"
            ? body.optionId.trim()
            : typeof body.themeOptionId === "string"
              ? body.themeOptionId.trim()
              : "";
          if (!optionId) {
            return { kind: "invalid_theme_option" as const };
          }
          const userDoc = await getDocument(`users/${uid}`, idToken);
          const ownedOptionIds = resolveOwnedOptionIds(userDoc.fields);
          return applyOwnedThemeOption(optionId, ownedOptionIds);
        }

        if (action === "set_avatar") {
          const avatarId = typeof body.avatarId === "string" ? body.avatarId.trim() : "";
          const userDoc = await getDocument(`users/${uid}`, idToken);
          const ownedOptionIds = resolveOwnedOptionIds(userDoc.fields);
          return applyOwnedAvatarOption(avatarId, ownedOptionIds);
        }

        if (action === "set_google_avatar") {
          const userDoc = await getDocument(`users/${uid}`, idToken);
          const googleAvatarUrl = readString(userDoc.fields, "photoUrl");
          return applyGoogleAvatar(googleAvatarUrl);
        }

        if (action === "set_confetti") {
          const optionId = typeof body.optionId === "string" ? body.optionId.trim() : "";
          const category = findStoreCategoryById("victory_confetti");
          const confettiOption = category?.options.find((entry) => entry.id === optionId) ?? null;
          if (!confettiOption) {
            return { kind: "invalid_option" as const };
          }
          const userDoc = await getDocument(`users/${uid}`, idToken);
          const ownedOptionIds = resolveOwnedOptionIds(userDoc.fields);
          if (!ownedOptionIds.has(confettiOption.id)) {
            return { kind: "missing_unlock" as const };
          }
          const familyId = await getPrimaryFamilyId(uid, idToken);
          const now = new Date().toISOString();
          await patchDocument(
            `users/${uid}`,
            {
              selectedConfettiOptionId: stringField(confettiOption.id),
              storeUpdatedAt: timestampField(now),
            },
            idToken,
            ["selectedConfettiOptionId", "storeUpdatedAt"],
          );
          if (familyId) {
            await patchDocument(
              `families/${familyId}/members/${uid}`,
              {
                selectedConfettiOptionId: stringField(confettiOption.id),
                updatedAt: timestampField(now),
              },
              idToken,
              ["selectedConfettiOptionId", "updatedAt"],
            );
            await trackAchievementEvent({
              uid,
              familyId,
              idToken,
              viewerRole: "player",
              eventId: `store_set_confetti_${confettiOption.id}`,
              metricDeltas: {
                confetti_applied: 1,
              },
              profileCustomizationKey: "confetti",
            });
          }
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
    if (data.kind === "invalid_theme_option") {
      return NextResponse.json({ error: "invalid_theme_option" }, { status: 400 });
    }
    if (data.kind === "already_owned") {
      return NextResponse.json({ error: "already_owned" }, { status: 409 });
    }
    if (data.kind === "insufficient_funds") {
      return NextResponse.json({ error: "insufficient_funds" }, { status: 409 });
    }
    if (data.kind === "reward_limit_reached") {
      return NextResponse.json({ error: "reward_limit_reached" }, { status: 409 });
    }
    if (data.kind === "missing_unlock") {
      return NextResponse.json({ error: "missing_unlock" }, { status: 403 });
    }
    if (data.kind === "google_avatar_unavailable") {
      return NextResponse.json({ error: "google_avatar_unavailable" }, { status: 404 });
    }
    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }

    let nextSession = refreshedSession;
    let shouldSetSessionCookie = refreshed;
    const maybeNextPicture = (data as { nextPicture?: unknown }).nextPicture;
    if (typeof maybeNextPicture === "string") {
      const trimmedNextPicture = maybeNextPicture.trim();
      if (trimmedNextPicture && trimmedNextPicture !== refreshedSession.picture) {
        nextSession = { ...refreshedSession, picture: trimmedNextPicture };
        shouldSetSessionCookie = true;
      }
    }

    const response = NextResponse.json({ success: true });
    if (shouldSetSessionCookie) {
      setSessionUserCookie(response, nextSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[STORE_POST_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "store_update_failed");
  }
}


