import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  boolField,
  documentIdFromName,
  findFirstFamilyIdByMemberUid,
  getDocument,
  listDocuments,
  patchDocument,
  readBoolean,
  readString,
  readStringArray,
  stringArrayField,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import {
  isValidCategoryColor,
  listFamilyCategories,
  MAX_CATEGORY_NAME_LENGTH,
  normalizeCategoryColor,
  normalizeCategoryIds,
  normalizeCategoryMemberIds,
  normalizeCategoryName,
  readChoreCategoryIds,
} from "@/lib/family/categories";

type UpdateCategoryBody = {
  name?: unknown;
  color?: unknown;
  memberIds?: unknown;
  memberId?: unknown;
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

async function listActiveMemberIds(familyId: string, idToken: string) {
  const memberDocs = await listDocuments(`families/${familyId}/members`, idToken, 200);
  const ids = new Set<string>();
  for (const doc of memberDocs) {
    if (readBoolean(doc.fields, "deleted")) {
      continue;
    }
    const id = documentIdFromName(doc.name);
    if (id) {
      ids.add(id);
    }
  }
  return ids;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ categoryId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  const { categoryId } = await context.params;
  if (!categoryId) {
    return NextResponse.json({ error: "category_id_required" }, { status: 400 });
  }

  let body: UpdateCategoryBody;
  try {
    body = (await request.json()) as UpdateCategoryBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const hasName = typeof body.name === "string";
  const hasColor = typeof body.color === "string";
  const hasMemberIds = Array.isArray(body.memberIds);
  const hasMemberId = typeof body.memberId === "string";
  if (!hasName && !hasColor && !hasMemberIds && !hasMemberId) {
    return NextResponse.json({ error: "update_values_required" }, { status: 400 });
  }

  const name = hasName ? normalizeCategoryName(String(body.name)) : "";
  const color = hasColor ? normalizeCategoryColor(String(body.color)) : "";
  const memberIds = hasMemberIds
    ? normalizeCategoryMemberIds(body.memberIds)
    : hasMemberId && String(body.memberId).trim()
      ? [String(body.memberId).trim()]
      : [];
  if (hasName && !name) {
    return NextResponse.json({ error: "name_required" }, { status: 400 });
  }
  if (hasName && name.length > MAX_CATEGORY_NAME_LENGTH) {
    return NextResponse.json({ error: "name_too_long" }, { status: 400 });
  }
  if (hasColor && !isValidCategoryColor(color)) {
    return NextResponse.json({ error: "invalid_color" }, { status: 400 });
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

        let categoryDoc;
        try {
          categoryDoc = await getDocument(`families/${familyId}/categories/${categoryId}`, idToken);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "";
          if (reason.includes("FIRESTORE_HTTP_404")) {
            return { kind: "category_not_found" as const };
          }
          throw error;
        }
        if (readBoolean(categoryDoc.fields, "deleted")) {
          return { kind: "category_not_found" as const };
        }

        const existingName = normalizeCategoryName(readString(categoryDoc.fields, "name"));
        const nextName = hasName ? name : existingName;
        if (!nextName) {
          return { kind: "name_required" as const };
        }

        if (hasName && nextName.toLowerCase() !== existingName.toLowerCase()) {
          const categories = await listFamilyCategories(familyId, idToken);
          if (
            categories.some(
              (category) =>
                category.id !== categoryId && category.name.toLowerCase() === nextName.toLowerCase(),
            )
          ) {
            return { kind: "category_name_exists" as const };
          }
        }

        if ((hasMemberIds || hasMemberId) && memberIds.length > 0) {
          const activeMemberIds = await listActiveMemberIds(familyId, idToken);
          if (memberIds.some((memberId: string) => !activeMemberIds.has(memberId))) {
            return { kind: "member_not_found" as const };
          }
        }

        const existingColor = normalizeCategoryColor(readString(categoryDoc.fields, "color"));
        const nextColor = hasColor ? color : existingColor;
        const existingMemberIds = normalizeCategoryMemberIds(readStringArray(categoryDoc.fields, "memberIds"));
        const legacyMemberId = readString(categoryDoc.fields, "memberId").trim();
        const nextMemberIds =
          hasMemberIds || hasMemberId
            ? memberIds
            : existingMemberIds.length > 0
              ? existingMemberIds
              : legacyMemberId
                ? [legacyMemberId]
                : [];
        const now = new Date().toISOString();
        await patchDocument(
          `families/${familyId}/categories/${categoryId}`,
          {
            name: stringField(nextName),
            color: stringField(nextColor),
            memberIds: stringArrayField(nextMemberIds),
            memberId: stringField(nextMemberIds[0] ?? ""),
            updatedAt: timestampField(now),
          },
          idToken,
          ["name", "color", "memberIds", "memberId", "updatedAt"],
        );

        return {
          kind: "ok" as const,
          category: {
            id: categoryId,
            name: nextName,
            color: nextColor,
            memberIds: nextMemberIds,
            memberId: nextMemberIds[0],
          },
        };
      });

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "forbidden_action") {
      return NextResponse.json({ error: "forbidden_action" }, { status: 403 });
    }
    if (data.kind === "category_not_found") {
      return NextResponse.json({ error: "category_not_found" }, { status: 404 });
    }
    if (data.kind === "member_not_found") {
      return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    }
    if (data.kind === "name_required") {
      return NextResponse.json({ error: "name_required" }, { status: 400 });
    }
    if (data.kind === "category_name_exists") {
      return NextResponse.json({ error: "category_name_exists" }, { status: 409 });
    }

    const response = NextResponse.json({ category: data.category });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[FAMILY_CATEGORY_PATCH_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "update_family_category_failed");
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ categoryId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  const { categoryId } = await context.params;
  if (!categoryId) {
    return NextResponse.json({ error: "category_id_required" }, { status: 400 });
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

        let categoryDoc;
        try {
          categoryDoc = await getDocument(`families/${familyId}/categories/${categoryId}`, idToken);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "";
          if (reason.includes("FIRESTORE_HTTP_404")) {
            return { kind: "category_not_found" as const };
          }
          throw error;
        }
        if (readBoolean(categoryDoc.fields, "deleted")) {
          return { kind: "category_not_found" as const };
        }

        const now = new Date().toISOString();
        await patchDocument(
          `families/${familyId}/categories/${categoryId}`,
          {
            deleted: boolField(true),
            deletedAt: timestampField(now),
            updatedAt: timestampField(now),
          },
          idToken,
          ["deleted", "deletedAt", "updatedAt"],
        );

        const choreDocs = await listDocuments(`families/${familyId}/chores`, idToken, 1000);
        const choresToUpdate = choreDocs
          .map((doc) => {
            const choreId = documentIdFromName(doc.name);
            const categoryIds = readChoreCategoryIds(doc.fields);
            if (!choreId || categoryIds.length === 0 || !categoryIds.includes(categoryId)) {
              return null;
            }
            return {
              choreId,
              categoryIds: normalizeCategoryIds(categoryIds.filter((id) => id !== categoryId)),
            };
          })
          .filter((entry): entry is { choreId: string; categoryIds: string[] } => Boolean(entry));

        await Promise.all(
          choresToUpdate.map((entry) =>
            patchDocument(
              `families/${familyId}/chores/${entry.choreId}`,
              {
                categoryIds: stringArrayField(entry.categoryIds),
                updatedAt: timestampField(now),
              },
              idToken,
              ["categoryIds", "updatedAt"],
            ),
          ),
        );

        return {
          kind: "ok" as const,
          updatedChores: choresToUpdate.length,
        };
      });

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "forbidden_action") {
      return NextResponse.json({ error: "forbidden_action" }, { status: 403 });
    }
    if (data.kind === "category_not_found") {
      return NextResponse.json({ error: "category_not_found" }, { status: 404 });
    }

    const response = NextResponse.json({ success: true, updatedChores: data.updatedChores });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[FAMILY_CATEGORY_DELETE_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "delete_family_category_failed");
  }
}
