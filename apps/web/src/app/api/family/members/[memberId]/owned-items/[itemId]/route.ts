import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  getDocument,
  integerField,
  listAllDocuments,
  patchDocument,
  readInteger,
  readString,
  readStringArray,
  stringArrayField,
  timestampField,
} from "@/lib/firestore/rest";
import { applyWalletDelta } from "@/lib/economy/wallet";
import { loadFamilyMemberProfileData } from "@/lib/family/member-profiles";
import {
  DEFAULT_COLOR_THEME_OPTION_ID,
  DEFAULT_CONFETTI_OPTION_ID,
} from "@/lib/store/catalog";

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

function parseQuantity(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const normalized = Math.max(0, Math.floor(parsed));
  return normalized;
}

async function resolveManagedMemberUid(
  memberId: string,
  session: ReturnType<typeof getSessionFromRequest> & { uid: string },
  idToken: string,
) {
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
  const managedUid = loadedProfile.profile.member.uid?.trim() ?? "";
  if (!managedUid) {
    return { kind: "member_uid_required" as const };
  }
  return {
    kind: "ok" as const,
    managedUid,
  };
}

function canRemoveStoreOption(optionId: string) {
  return optionId !== DEFAULT_COLOR_THEME_OPTION_ID && optionId !== DEFAULT_CONFETTI_OPTION_ID;
}

async function getPaidValueByItemId(uid: string, itemId: string, idToken: string) {
  const ledgerDocs = await listAllDocuments(`users/${uid}/walletLedger`, idToken, { cap: 500 });
  let totalPaidValue = 0;
  for (const doc of ledgerDocs) {
    if (readString(doc.fields, "reason") !== "store_purchase") {
      continue;
    }
    if (readString(doc.fields, "itemId") !== itemId) {
      continue;
    }
    totalPaidValue += Math.max(0, readInteger(doc.fields, "debitAmount"));
  }
  return Math.max(0, totalPaidValue);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ memberId: string; itemId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  const { memberId, itemId } = await context.params;
  if (!memberId || !itemId) {
    return NextResponse.json({ error: "item_id_required" }, { status: 400 });
  }

  let body: { quantity?: unknown };
  try {
    body = (await request.json()) as { quantity?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const quantity = parseQuantity(body.quantity);
  if (quantity === null) {
    return NextResponse.json({ error: "invalid_quantity" }, { status: 400 });
  }

  try {
    const { data, session: refreshedSession, refreshed } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        const managedMember = await resolveManagedMemberUid(memberId, session, idToken);
        if (managedMember.kind !== "ok") {
          return managedMember;
        }

        const managedUid = managedMember.managedUid;
        const inventoryPath = `users/${managedUid}/inventory/${itemId}`;
        try {
          const inventoryDoc = await getDocument(inventoryPath, idToken);
          const now = new Date().toISOString();
          await patchDocument(
            inventoryPath,
            {
              quantity: integerField(quantity),
              totalAcquired: integerField(readInteger(inventoryDoc.fields, "totalAcquired")),
              totalConsumed: integerField(readInteger(inventoryDoc.fields, "totalConsumed")),
              updatedAt: timestampField(now),
            },
            idToken,
            ["quantity", "totalAcquired", "totalConsumed", "updatedAt"],
          );
          return { kind: "ok" as const };
        } catch (error) {
          const reason = error instanceof Error ? error.message : "";
          if (!reason.includes("FIRESTORE_HTTP_404")) {
            throw error;
          }
        }

        const userDoc = await getDocument(`users/${managedUid}`, idToken);
        const owned = new Set(readStringArray(userDoc.fields, "ownedStoreOptionIds"));
        if (!owned.has(itemId)) {
          return { kind: "owned_item_not_found" as const };
        }
        if (quantity > 1) {
          return { kind: "invalid_quantity" as const };
        }
        if (quantity === 0) {
          if (!canRemoveStoreOption(itemId)) {
            return { kind: "default_option_locked" as const };
          }
          owned.delete(itemId);
        } else {
          owned.add(itemId);
        }
        await patchDocument(
          `users/${managedUid}`,
          {
            ownedStoreOptionIds: stringArrayField(Array.from(owned)),
            storeUpdatedAt: timestampField(new Date().toISOString()),
          },
          idToken,
          ["ownedStoreOptionIds", "storeUpdatedAt"],
        );
        return { kind: "ok" as const };
      },
    );

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "member_not_found") {
      return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    }
    if (data.kind === "forbidden") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (data.kind === "member_uid_required") {
      return NextResponse.json({ error: "member_uid_required" }, { status: 409 });
    }
    if (data.kind === "owned_item_not_found") {
      return NextResponse.json({ error: "owned_item_not_found" }, { status: 404 });
    }
    if (data.kind === "default_option_locked") {
      return NextResponse.json({ error: "default_option_locked" }, { status: 409 });
    }
    if (data.kind === "invalid_quantity") {
      return NextResponse.json({ error: "invalid_quantity" }, { status: 400 });
    }

    const response = NextResponse.json({ success: true });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
    console.error("[FAMILY_MEMBER_OWNED_ITEM_PATCH_ERROR]", reason);
    if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
      return jsonReauthRequired();
    }
    if (reason.includes("FIRESTORE_HTTP_403")) {
      return jsonFirestoreForbidden();
    }
    return NextResponse.json({ error: "owned_item_update_failed" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ memberId: string; itemId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  const { memberId, itemId } = await context.params;
  if (!memberId || !itemId) {
    return NextResponse.json({ error: "item_id_required" }, { status: 400 });
  }
  let creditPaidValue = true;
  try {
    const body = (await request.json()) as { creditPaidValue?: unknown };
    if (typeof body.creditPaidValue === "boolean") {
      creditPaidValue = body.creditPaidValue;
    }
  } catch {
    // Keep default behavior when request body is omitted.
  }

  try {
    const { data, session: refreshedSession, refreshed } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        const managedMember = await resolveManagedMemberUid(memberId, session, idToken);
        if (managedMember.kind !== "ok") {
          return managedMember;
        }
        const managedUid = managedMember.managedUid;
        const paidValue = await getPaidValueByItemId(managedUid, itemId, idToken);
        const inventoryPath = `users/${managedUid}/inventory/${itemId}`;
        try {
          const inventoryDoc = await getDocument(inventoryPath, idToken);
          await patchDocument(
            inventoryPath,
            {
              quantity: integerField(0),
              totalAcquired: integerField(readInteger(inventoryDoc.fields, "totalAcquired")),
              totalConsumed: integerField(readInteger(inventoryDoc.fields, "totalConsumed")),
              updatedAt: timestampField(new Date().toISOString()),
            },
            idToken,
            ["quantity", "totalAcquired", "totalConsumed", "updatedAt"],
          );
          if (creditPaidValue && paidValue > 0) {
            await applyWalletDelta({
              uid: managedUid,
              idToken,
              delta: paidValue,
              reason: "manual_adjustment",
              itemId,
            });
          }
          return { kind: "ok" as const };
        } catch (error) {
          const reason = error instanceof Error ? error.message : "";
          if (!reason.includes("FIRESTORE_HTTP_404")) {
            throw error;
          }
        }

        const userDoc = await getDocument(`users/${managedUid}`, idToken);
        const owned = new Set(readStringArray(userDoc.fields, "ownedStoreOptionIds"));
        if (!owned.has(itemId)) {
          return { kind: "owned_item_not_found" as const };
        }
        if (!canRemoveStoreOption(itemId)) {
          return { kind: "default_option_locked" as const };
        }
        owned.delete(itemId);
        await patchDocument(
          `users/${managedUid}`,
          {
            ownedStoreOptionIds: stringArrayField(Array.from(owned)),
            storeUpdatedAt: timestampField(new Date().toISOString()),
          },
          idToken,
          ["ownedStoreOptionIds", "storeUpdatedAt"],
        );
        if (creditPaidValue && paidValue > 0) {
          await applyWalletDelta({
            uid: managedUid,
            idToken,
            delta: paidValue,
            reason: "manual_adjustment",
            itemId,
          });
        }
        return { kind: "ok" as const };
      },
    );

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "member_not_found") {
      return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    }
    if (data.kind === "forbidden") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (data.kind === "member_uid_required") {
      return NextResponse.json({ error: "member_uid_required" }, { status: 409 });
    }
    if (data.kind === "owned_item_not_found") {
      return NextResponse.json({ error: "owned_item_not_found" }, { status: 404 });
    }
    if (data.kind === "default_option_locked") {
      return NextResponse.json({ error: "default_option_locked" }, { status: 409 });
    }

    const response = NextResponse.json({ success: true });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "unknown";
    console.error("[FAMILY_MEMBER_OWNED_ITEM_DELETE_ERROR]", reason);
    if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
      return jsonReauthRequired();
    }
    if (reason.includes("FIRESTORE_HTTP_403")) {
      return jsonFirestoreForbidden();
    }
    return NextResponse.json({ error: "owned_item_remove_failed" }, { status: 500 });
  }
}
