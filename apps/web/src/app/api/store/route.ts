import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { applyWalletDelta, getPrimaryFamilyId, getWalletBalance } from "@/lib/economy/wallet";
import {
  getDocument,
  listDocuments,
  patchDocument,
  readBoolean,
  readInteger,
  readString,
  readStringArray,
  stringArrayField,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import {
  DEFAULT_AVATAR_IDS,
  STORE_ITEMS,
  findStoreItemById,
  isAllowedDashboardColor,
  isStoreItemId,
  normalizeColor,
} from "@/lib/store/catalog";

type StoreActionBody = {
  action?: unknown;
  itemId?: unknown;
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

async function getStoreSummary(uid: string, idToken: string) {
  const userDoc = await getDocument(`users/${uid}`, idToken);
  const familyId = readStringArray(userDoc.fields, "familyIds")[0] ?? "";
  const balance = Math.max(0, readInteger(userDoc.fields, "walletBalance"));
  const ownedItemIds = readStringArray(userDoc.fields, "ownedStoreItemIds").filter(isStoreItemId);

  let dashboardPrimaryColor = "";
  let avatarId = "";
  let unavailableColors: string[] = [];
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
    const members = await listDocuments(`families/${familyId}/members`, idToken, 200);
    unavailableColors = members
      .filter((doc) => !readBoolean(doc.fields, "deleted"))
      .filter((doc) => readString(doc.fields, "uid") !== uid)
      .map((doc) => normalizeColor(readString(doc.fields, "dashboardPrimaryColor")))
      .filter((entry) => entry.length > 0);
  }

  return {
    balance,
    familyId,
    ownedItemIds,
    dashboardPrimaryColor,
    avatarId,
    unavailableColors: Array.from(new Set(unavailableColors)),
    catalog: STORE_ITEMS,
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
        if (action === "purchase") {
          const itemId = typeof body.itemId === "string" ? body.itemId : "";
          const item = findStoreItemById(itemId);
          if (!item) {
            return { kind: "invalid_item" as const };
          }

          const userDoc = await getDocument(`users/${session.uid}`, idToken);
          const ownedItemIds = readStringArray(userDoc.fields, "ownedStoreItemIds").filter(
            isStoreItemId,
          );
          if (ownedItemIds.includes(item.id)) {
            return { kind: "already_owned" as const };
          }
          const balance = await getWalletBalance(session.uid, idToken);
          if (balance < item.price) {
            return { kind: "insufficient_funds" as const };
          }

          await applyWalletDelta({
            uid: session.uid,
            idToken,
            delta: -item.price,
            reason: "store_purchase",
            itemId: item.id,
          });
          await patchDocument(
            `users/${session.uid}`,
            {
              ownedStoreItemIds: stringArrayField([...ownedItemIds, item.id]),
              storeUpdatedAt: timestampField(new Date().toISOString()),
            },
            idToken,
            ["ownedStoreItemIds", "storeUpdatedAt"],
          );
          return { kind: "ok" as const };
        }

        if (action === "set_color") {
          const color = typeof body.color === "string" ? normalizeColor(body.color) : "";
          if (!isAllowedDashboardColor(color)) {
            return { kind: "invalid_color" as const };
          }

          const userDoc = await getDocument(`users/${session.uid}`, idToken);
          const ownedItemIds = readStringArray(userDoc.fields, "ownedStoreItemIds").filter(
            isStoreItemId,
          );
          if (!ownedItemIds.includes("customize_colors")) {
            return { kind: "missing_unlock" as const };
          }
          const familyId = await getPrimaryFamilyId(session.uid, idToken);
          if (!familyId) {
            return { kind: "family_not_found" as const };
          }
          const members = await listDocuments(`families/${familyId}/members`, idToken, 200);
          const duplicate = members.some((doc) => {
            if (readBoolean(doc.fields, "deleted")) {
              return false;
            }
            if (readString(doc.fields, "uid") === session.uid) {
              return false;
            }
            return normalizeColor(readString(doc.fields, "dashboardPrimaryColor")) === color;
          });
          if (duplicate) {
            return { kind: "color_taken" as const };
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
          const userDoc = await getDocument(`users/${session.uid}`, idToken);
          const ownedItemIds = readStringArray(userDoc.fields, "ownedStoreItemIds").filter(
            isStoreItemId,
          );
          if (!ownedItemIds.includes("customize_avatar")) {
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

        return { kind: "invalid_action" as const };
      },
    );

    if (data.kind === "invalid_action") {
      return NextResponse.json({ error: "invalid_action" }, { status: 400 });
    }
    if (data.kind === "invalid_item") {
      return NextResponse.json({ error: "invalid_item" }, { status: 400 });
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
    if (data.kind === "color_taken") {
      return NextResponse.json({ error: "color_taken" }, { status: 409 });
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
