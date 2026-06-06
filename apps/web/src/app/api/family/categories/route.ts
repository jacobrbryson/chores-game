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
  readBoolean,
  readString,
  readStringArray,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import {
  isValidCategoryColor,
  listFamilyCategories,
  MAX_CATEGORY_NAME_LENGTH,
  normalizeCategoryColor,
  normalizeCategoryName,
} from "@/lib/family/categories";
import { trackAchievementEvent } from "@/lib/achievements/service";

type CategoryBody = {
  name?: unknown;
  color?: unknown;
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
    const id = doc.name.split("/").pop() ?? "";
    if (id) {
      ids.add(id);
    }
  }
  return ids;
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
            categories: [],
          };
        }
        const [viewerRole, categories] = await Promise.all([
          getViewerRole(familyId, session.uid, idToken),
          listFamilyCategories(familyId, idToken),
        ]);
        return {
          noFamily: false,
          viewerRole,
          categories,
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
    console.error("[FAMILY_CATEGORIES_GET_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "family_categories_unavailable");
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

  let body: CategoryBody;
  try {
    body = (await request.json()) as CategoryBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? normalizeCategoryName(body.name) : "";
  const color =
    typeof body.color === "string" ? normalizeCategoryColor(body.color) : "";
  const memberId = typeof body.memberId === "string" ? body.memberId.trim() : "";

  if (!name) {
    return NextResponse.json({ error: "name_required" }, { status: 400 });
  }
  if (name.length > MAX_CATEGORY_NAME_LENGTH) {
    return NextResponse.json({ error: "name_too_long" }, { status: 400 });
  }
  if (!isValidCategoryColor(color)) {
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

        if (memberId) {
          const memberIds = await listActiveMemberIds(familyId, idToken);
          if (!memberIds.has(memberId)) {
            return { kind: "member_not_found" as const };
          }
        }

        const existingCategories = await listFamilyCategories(familyId, idToken);
        const normalizedName = name.toLowerCase();
        if (
          existingCategories.some((category) => category.name.toLowerCase() === normalizedName)
        ) {
          return { kind: "category_name_exists" as const };
        }

        const categoryId = randomUUID();
        const now = new Date().toISOString();
        await createOrReplaceDocument(
          `families/${familyId}/categories/${categoryId}`,
          {
            name: stringField(name),
            color: stringField(color),
            memberId: stringField(memberId),
            deleted: boolField(false),
            createdBy: stringField(session.uid),
            createdAt: timestampField(now),
            updatedAt: timestampField(now),
          },
          idToken,
        );
        await trackAchievementEvent({
          uid: session.uid,
          familyId,
          idToken,
          viewerRole,
          eventId: `family_category_create_${categoryId}`,
          metricDeltas: {
            admin_categories_created: 1,
          },
        });

        return {
          kind: "ok" as const,
          category: {
            id: categoryId,
            name,
            color,
            memberId,
          },
        };
      });

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "forbidden_action") {
      return NextResponse.json({ error: "forbidden_action" }, { status: 403 });
    }
    if (data.kind === "member_not_found") {
      return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    }
    if (data.kind === "category_name_exists") {
      return NextResponse.json({ error: "category_name_exists" }, { status: 409 });
    }

    const response = NextResponse.json({ category: data.category }, { status: 201 });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[FAMILY_CATEGORIES_CREATE_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "create_family_category_failed");
  }
}
