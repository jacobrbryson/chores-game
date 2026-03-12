import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  documentIdFromName,
  boolField,
  type FirestoreValue,
  getDocument,
  listDocuments,
  patchDocument,
  readBoolean,
  readString,
  readStringArray,
  readInteger,
  readTimestamp,
  stringArrayField,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import { emitFamilyActivity } from "@/lib/notifications/events";
import { applyWalletDelta } from "@/lib/economy/wallet";
import { publishFamilyActivity } from "@/lib/ws/publish-family-activity";
import { resolveMemberPrimaryColor } from "@/lib/theme/member-primary-color";
import { GOOGLE_TASKS_CHORE_SOURCE, syncGoogleTasksForUser } from "@/lib/google/tasks-sync";
import {
  buildCategoryMap,
  hasAllCategoryIds,
  listFamilyCategories,
  normalizeCategoryIds,
  readChoreCategoryIds,
  resolveChoreCategories,
} from "@/lib/family/categories";

type UpdateChoreBody = {
  action?: unknown;
  description?: unknown;
  assigneeId?: unknown;
  dueDate?: unknown;
  details?: unknown;
  categoryIds?: unknown;
};
const MAX_ACTIVE_CHORES_PER_ASSIGNEE = 100;

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

async function getPrimaryFamilyId(uid: string, idToken: string) {
  const userDoc = await getDocument(`users/${uid}`, idToken);
  return readStringArray(userDoc.fields, "familyIds")[0] ?? "";
}

function normalizeDescription(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function asValidDate(value: unknown) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  return "";
}

async function getFamilyMemberName(
  familyId: string,
  memberId: string,
  idToken: string,
) {
  try {
    const memberDoc = await getDocument(`families/${familyId}/members/${memberId}`, idToken);
    return readString(memberDoc.fields, "name") || "Unassigned";
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_HTTP_404")) {
      return "Unassigned";
    }
    throw error;
  }
}

async function resolveAssigneePrimaryColor(
  familyId: string,
  assigneeId: string,
  idToken: string,
) {
  if (!assigneeId) {
    return undefined;
  }
  try {
    const memberDoc = await getDocument(`families/${familyId}/members/${assigneeId}`, idToken);
    if (readBoolean(memberDoc.fields, "deleted")) {
      return undefined;
    }
    return resolveMemberPrimaryColor(
      readString(memberDoc.fields, "dashboardPrimaryColor") || undefined,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_HTTP_404")) {
      throw error;
    }
  }

  const memberDocs = await listDocuments(`families/${familyId}/members`, idToken, 100);
  const normalizedAssignee = normalizeEmail(assigneeId);
  const matchedMember = memberDocs.find((doc) => {
    if (readBoolean(doc.fields, "deleted")) {
      return false;
    }
    const memberId = documentIdFromName(doc.name);
    if (memberId === assigneeId) {
      return true;
    }
    const memberUid = readString(doc.fields, "uid");
    if (memberUid && memberUid === assigneeId) {
      return true;
    }
    const memberEmail = normalizeEmail(readString(doc.fields, "email"));
    return Boolean(memberEmail) && memberEmail === normalizedAssignee;
  });
  if (!matchedMember) {
    return undefined;
  }
  return resolveMemberPrimaryColor(
    readString(matchedMember.fields, "dashboardPrimaryColor") || undefined,
  );
}

async function resolveAssigneeAvatarId(
  familyId: string,
  assigneeId: string,
  idToken: string,
) {
  if (!assigneeId) {
    return undefined;
  }
  try {
    const memberDoc = await getDocument(`families/${familyId}/members/${assigneeId}`, idToken);
    if (readBoolean(memberDoc.fields, "deleted")) {
      return undefined;
    }
    const avatarId = readString(memberDoc.fields, "avatarId");
    return avatarId || undefined;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_HTTP_404")) {
      throw error;
    }
  }

  const memberDocs = await listDocuments(`families/${familyId}/members`, idToken, 100);
  const normalizedAssignee = normalizeEmail(assigneeId);
  const matchedMember = memberDocs.find((doc) => {
    if (readBoolean(doc.fields, "deleted")) {
      return false;
    }
    const memberId = documentIdFromName(doc.name);
    if (memberId === assigneeId) {
      return true;
    }
    const memberUid = readString(doc.fields, "uid");
    if (memberUid && memberUid === assigneeId) {
      return true;
    }
    const memberEmail = normalizeEmail(readString(doc.fields, "email"));
    return Boolean(memberEmail) && memberEmail === normalizedAssignee;
  });
  if (!matchedMember) {
    return undefined;
  }
  const avatarId = readString(matchedMember.fields, "avatarId");
  return avatarId || undefined;
}

async function resolveAssigneeAvatarPhotoUrl(
  familyId: string,
  assigneeId: string,
  idToken: string,
) {
  if (!assigneeId) {
    return undefined;
  }
  try {
    const memberDoc = await getDocument(`families/${familyId}/members/${assigneeId}`, idToken);
    if (readBoolean(memberDoc.fields, "deleted")) {
      return undefined;
    }
    const avatarPhotoUrl = readString(memberDoc.fields, "avatarPhotoUrl");
    return avatarPhotoUrl || undefined;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_HTTP_404")) {
      throw error;
    }
  }

  const memberDocs = await listDocuments(`families/${familyId}/members`, idToken, 100);
  const normalizedAssignee = normalizeEmail(assigneeId);
  const matchedMember = memberDocs.find((doc) => {
    if (readBoolean(doc.fields, "deleted")) {
      return false;
    }
    const memberId = documentIdFromName(doc.name);
    if (memberId === assigneeId) {
      return true;
    }
    const memberUid = readString(doc.fields, "uid");
    if (memberUid && memberUid === assigneeId) {
      return true;
    }
    const memberEmail = normalizeEmail(readString(doc.fields, "email"));
    return Boolean(memberEmail) && memberEmail === normalizedAssignee;
  });
  if (!matchedMember) {
    return undefined;
  }
  const avatarPhotoUrl = readString(matchedMember.fields, "avatarPhotoUrl");
  return avatarPhotoUrl || undefined;
}

async function resolveAssigneeUid(
  familyId: string,
  assigneeId: string,
  idToken: string,
) {
  if (!assigneeId) {
    return "";
  }
  try {
    const memberDoc = await getDocument(`families/${familyId}/members/${assigneeId}`, idToken);
    const memberUid = readString(memberDoc.fields, "uid");
    return memberUid || assigneeId;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_HTTP_404")) {
      return assigneeId;
    }
    throw error;
  }
}

async function countActiveChoresForAssignee(
  familyId: string,
  assigneeId: string,
  idToken: string,
  excludeChoreId?: string,
) {
  if (!assigneeId) {
    return 0;
  }
  const docs = await listDocuments(`families/${familyId}/chores`, idToken, 1000);
  return docs.filter((doc) => {
    const id = documentIdFromName(doc.name);
    if (excludeChoreId && id === excludeChoreId) {
      return false;
    }
    if (readBoolean(doc.fields, "deleted")) {
      return false;
    }
    const status = readString(doc.fields, "status");
    if (status !== "Open") {
      return false;
    }
    return readString(doc.fields, "assigneeId") === assigneeId;
  }).length;
}

function mapCommonFirestoreErrors(reason: string, fallbackError: string) {
  if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
    return jsonReauthRequired();
  }
  if (reason.includes("FIRESTORE_HTTP_403")) {
    return jsonFirestoreForbidden();
  }
  if (
    reason.includes("FIRESTORE_HTTP_404") &&
    reason.toLowerCase().includes("document") &&
    reason.toLowerCase().includes("not found")
  ) {
    return NextResponse.json({ error: "chore_not_found" }, { status: 404 });
  }
  return NextResponse.json({ error: fallbackError }, { status: 500 });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ choreId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  const { choreId } = await context.params;
  if (!choreId) {
    return NextResponse.json({ error: "chore_id_required" }, { status: 400 });
  }

  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        const familyId = await getPrimaryFamilyId(session.uid, idToken);
        if (!familyId) {
          return { kind: "family_not_found" as const };
        }
        const requester = await getRequesterContext(
          familyId,
          session.uid,
          session.email,
          idToken,
        );
        const choreDoc = await getDocument(`families/${familyId}/chores/${choreId}`, idToken);
        if (readBoolean(choreDoc.fields, "deleted")) {
          return { kind: "chore_not_found" as const };
        }
        const categories = await listFamilyCategories(familyId, idToken);
        const categoryMap = buildCategoryMap(categories);
        const categoryIds = readChoreCategoryIds(choreDoc.fields);
        return {
          kind: "ok" as const,
          chore: {
            id: choreId,
            title: readString(choreDoc.fields, "title") || "Untitled chore",
            status: readString(choreDoc.fields, "status") || "Open",
            source:
              readString(choreDoc.fields, "source") === GOOGLE_TASKS_CHORE_SOURCE
                ? "google_tasks"
                : "manual",
            sortOrder: readOptionalSortOrder(choreDoc.fields),
            assigneeId: readString(choreDoc.fields, "assigneeId") || undefined,
            assigneeName: readString(choreDoc.fields, "assigneeName") || "Unassigned",
            assigneePrimaryColor: await resolveAssigneePrimaryColor(
              familyId,
              readString(choreDoc.fields, "assigneeId"),
              idToken,
            ),
            assigneeAvatarId: await resolveAssigneeAvatarId(
              familyId,
              readString(choreDoc.fields, "assigneeId"),
              idToken,
            ),
            assigneeAvatarPhotoUrl: await resolveAssigneeAvatarPhotoUrl(
              familyId,
              readString(choreDoc.fields, "assigneeId"),
              idToken,
            ),
            details: readString(choreDoc.fields, "details") || undefined,
            dueDate: readString(choreDoc.fields, "dueDate"),
            categoryIds,
            categories: resolveChoreCategories(categoryIds, categoryMap),
            completedAt:
              readString(choreDoc.fields, "status") === "Submitted" ||
              readString(choreDoc.fields, "status") === "Approved"
                ? readTimestamp(choreDoc.fields, "submittedAt") ||
                  readTimestamp(choreDoc.fields, "updatedAt") ||
                  undefined
                : undefined,
            coinValue: readInteger(choreDoc.fields, "coinValue") || 10,
            createdAt: readTimestamp(choreDoc.fields, "createdAt") || undefined,
          },
          viewerRole: requester.role,
        };
      });

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "chore_not_found") {
      return NextResponse.json({ error: "chore_not_found" }, { status: 404 });
    }

    const response = NextResponse.json({ chore: data.chore, viewerRole: data.viewerRole });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[CHORE_GET_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "chore_unavailable");
  }
}

type RequesterContext = {
  role: "admin" | "player";
  assigneeAliases: Set<string>;
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function readOptionalSortOrder(
  fields: Record<string, FirestoreValue> | undefined,
) {
  const value = fields?.sortOrder;
  if (!value) {
    return undefined;
  }
  const raw =
    "integerValue" in value
      ? value.integerValue
      : "stringValue" in value
        ? value.stringValue
        : "";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  const normalized = Math.floor(parsed);
  if (normalized < 0) {
    return undefined;
  }
  return normalized;
}

function isRequesterAssignee(choreAssigneeId: string, uid: string, email: string) {
  if (!choreAssigneeId) {
    return false;
  }
  if (choreAssigneeId === uid) {
    return true;
  }
  const normalizedAssignee = normalizeEmail(choreAssigneeId);
  const normalizedEmail = normalizeEmail(email);
  return Boolean(normalizedEmail) && normalizedAssignee === normalizedEmail;
}

function toRole(value: string) {
  return value === "admin" ? "admin" : "player";
}

async function getRequesterContext(
  familyId: string,
  uid: string,
  email: string,
  idToken: string,
): Promise<RequesterContext> {
  const aliases = new Set<string>([uid]);
  let role: "admin" | "player" = "player";
  let roleResolved = false;
  const normalizedEmail = normalizeEmail(email);

  async function mergeMemberDoc(memberDocId: string) {
    if (!memberDocId) {
      return false;
    }
    try {
      const memberDoc = await getDocument(`families/${familyId}/members/${memberDocId}`, idToken);
      if (readBoolean(memberDoc.fields, "deleted")) {
        return false;
      }
      aliases.add(memberDocId);
      const memberUid = readString(memberDoc.fields, "uid");
      const memberEmail = normalizeEmail(readString(memberDoc.fields, "email"));
      if (memberUid) {
        aliases.add(memberUid);
      }
      if (memberEmail) {
        aliases.add(memberEmail);
      }
      if (!roleResolved) {
        role = toRole(readString(memberDoc.fields, "role"));
        roleResolved = true;
      }
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      if (reason.includes("FIRESTORE_HTTP_404")) {
        return false;
      }
      throw error;
    }
  }

  const foundUidMemberDoc = await mergeMemberDoc(uid);
  if (normalizedEmail && normalizedEmail !== uid) {
    await mergeMemberDoc(normalizedEmail);
  }

  if (!foundUidMemberDoc || !roleResolved) {
    const memberDocs = await listDocuments(`families/${familyId}/members`, idToken, 200);
    for (const doc of memberDocs) {
      if (readBoolean(doc.fields, "deleted")) {
        continue;
      }
      const memberId = documentIdFromName(doc.name);
      const memberUid = readString(doc.fields, "uid");
      const memberEmail = normalizeEmail(readString(doc.fields, "email"));
      const uidMatch = memberUid === uid;
      const emailMatch = normalizedEmail && memberEmail === normalizedEmail;
      if (!uidMatch && !emailMatch) {
        continue;
      }
      aliases.add(memberId);
      if (memberUid) {
        aliases.add(memberUid);
      }
      if (memberEmail) {
        aliases.add(memberEmail);
      }
      if (uidMatch) {
        role = toRole(readString(doc.fields, "role"));
        roleResolved = true;
      }
    }
  }

  return { role, assigneeAliases: aliases };
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ choreId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  const { choreId } = await context.params;
  if (!choreId) {
    return NextResponse.json({ error: "chore_id_required" }, { status: 400 });
  }

  let body: UpdateChoreBody;
  try {
    body = (await request.json()) as UpdateChoreBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "edit";
  if (action !== "edit" && action !== "complete" && action !== "undo_complete" && action !== "set_categories") {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  const normalizedDescription =
    typeof body.description === "string" ? normalizeDescription(body.description) : "";
  const assigneeId =
    typeof body.assigneeId === "string" && body.assigneeId.trim().length > 0
      ? body.assigneeId.trim()
      : "";
  const dueDate = asValidDate(body.dueDate);
  const details =
    typeof body.details === "string" && body.details.trim().length > 0
      ? body.details.trim().slice(0, 2000)
      : "";
  const hasCategoryIds = Array.isArray(body.categoryIds);
  const categoryIds = normalizeCategoryIds(body.categoryIds);

  if (action === "set_categories" && !hasCategoryIds) {
    return NextResponse.json({ error: "category_ids_required" }, { status: 400 });
  }

  if (action === "edit") {
    if (!normalizedDescription) {
      return NextResponse.json({ error: "description_required" }, { status: 400 });
    }
    if (normalizedDescription.length > 160) {
      return NextResponse.json({ error: "description_too_long" }, { status: 400 });
    }
    if (!dueDate) {
      return NextResponse.json({ error: "due_date_required" }, { status: 400 });
    }
  }

  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        const familyId = await getPrimaryFamilyId(session.uid, idToken);
        if (!familyId) {
          return { kind: "family_not_found" as const };
        }

        const now = new Date().toISOString();
        const actorName = session.name || session.email;
        let syncOwnerUid = "";
        if (action === "complete") {
          const existingChoreDoc = await getDocument(`families/${familyId}/chores/${choreId}`, idToken);
          const choreTitle = readString(existingChoreDoc.fields, "title") || "Untitled chore";
          const choreAssigneeId = readString(existingChoreDoc.fields, "assigneeId");
          const choreSource = readString(existingChoreDoc.fields, "source");
          const choreGoogleTaskOwnerUid = readString(existingChoreDoc.fields, "googleTaskOwnerUid");
          const choreCoinValue = Math.max(0, readInteger(existingChoreDoc.fields, "coinValue") || 0);
          const currentStatus = readString(existingChoreDoc.fields, "status") || "Open";
          if (choreSource === GOOGLE_TASKS_CHORE_SOURCE && choreGoogleTaskOwnerUid) {
            syncOwnerUid = choreGoogleTaskOwnerUid;
          } else if (isRequesterAssignee(choreAssigneeId, session.uid, session.email)) {
            syncOwnerUid = session.uid;
          }
          if (currentStatus !== "Open") {
            return { kind: "invalid_transition" as const };
          }
          const requesterOwnsChore = isRequesterAssignee(
            choreAssigneeId,
            session.uid,
            session.email,
          );
          if (!requesterOwnsChore) {
            const requester = await getRequesterContext(
              familyId,
              session.uid,
              session.email,
              idToken,
            );
            if (requester.role !== "admin") {
              return { kind: "forbidden_action" as const };
            }
          }
          await patchDocument(
            `families/${familyId}/chores/${choreId}`,
            {
              status: stringField("Submitted"),
              submittedAt: timestampField(now),
              updatedAt: timestampField(now),
            },
            idToken,
            ["status", "submittedAt", "updatedAt"],
          );
          const assigneeUid = await resolveAssigneeUid(familyId, choreAssigneeId, idToken);
          if (assigneeUid && choreCoinValue > 0) {
            try {
              await applyWalletDelta({
                uid: assigneeUid,
                idToken,
                delta: choreCoinValue,
                reason: "chore_complete",
                choreId,
              });
            } catch (error) {
              const reason = error instanceof Error ? error.message : "";
              if (!reason.includes("FIRESTORE_HTTP_404")) {
                throw error;
              }
            }
          }
          await emitFamilyActivity({
            familyId,
            idToken,
            kind: "chore_completed",
            actorUid: session.uid,
            actorEmail: session.email,
            actorName,
            title: "Chore completed",
            message: `${actorName} marked "${choreTitle}" complete.`,
            choreId,
            choreTitle,
            relatedIds: choreAssigneeId ? [choreAssigneeId] : [],
          });
          await publishFamilyActivity({
            type: "chore_completed",
            familyId,
            choreId,
            occurredAt: now,
          });
        } else if (action === "undo_complete") {
          const requester = await getRequesterContext(
            familyId,
            session.uid,
            session.email,
            idToken,
          );
          if (requester.role !== "admin") {
            return { kind: "forbidden_action" as const };
          }
          const existingChoreDoc = await getDocument(`families/${familyId}/chores/${choreId}`, idToken);
          const currentStatus = readString(existingChoreDoc.fields, "status") || "Open";
          const choreTitle = readString(existingChoreDoc.fields, "title") || "Untitled chore";
          const choreAssigneeId = readString(existingChoreDoc.fields, "assigneeId");
          const choreSource = readString(existingChoreDoc.fields, "source");
          const choreGoogleTaskOwnerUid = readString(existingChoreDoc.fields, "googleTaskOwnerUid");
          const choreCoinValue = Math.max(0, readInteger(existingChoreDoc.fields, "coinValue") || 0);
          if (choreSource === GOOGLE_TASKS_CHORE_SOURCE && choreGoogleTaskOwnerUid) {
            syncOwnerUid = choreGoogleTaskOwnerUid;
          } else if (isRequesterAssignee(choreAssigneeId, session.uid, session.email)) {
            syncOwnerUid = session.uid;
          }
          if (currentStatus !== "Submitted" && currentStatus !== "Approved") {
            return { kind: "invalid_transition" as const };
          }
          await patchDocument(
            `families/${familyId}/chores/${choreId}`,
            {
              status: stringField("Open"),
              updatedAt: timestampField(now),
            },
            idToken,
            ["status", "updatedAt"],
          );
          const assigneeUid = await resolveAssigneeUid(familyId, choreAssigneeId, idToken);
          if (assigneeUid && choreCoinValue > 0) {
            try {
              await applyWalletDelta({
                uid: assigneeUid,
                idToken,
                delta: -choreCoinValue,
                reason: "chore_undo_complete",
                choreId,
              });
            } catch (error) {
              const reason = error instanceof Error ? error.message : "";
              if (reason.includes("WALLET_NEGATIVE_BLOCKED")) {
                return { kind: "wallet_negative_blocked" as const };
              }
              if (!reason.includes("FIRESTORE_HTTP_404")) {
                throw error;
              }
            }
          }
          await emitFamilyActivity({
            familyId,
            idToken,
            kind: "chore_undo_completed",
            actorUid: session.uid,
            actorEmail: session.email,
            actorName,
            title: "Completion undone",
            message: `${actorName} moved "${choreTitle}" back to open.`,
            choreId,
            choreTitle,
            relatedIds: choreAssigneeId ? [choreAssigneeId] : [],
          });
          await publishFamilyActivity({
            type: "chore_updated",
            familyId,
            choreId,
            occurredAt: now,
          });
        } else if (action === "set_categories") {
          const requester = await getRequesterContext(
            familyId,
            session.uid,
            session.email,
            idToken,
          );
          if (requester.role !== "admin") {
            return { kind: "forbidden_action" as const };
          }
          const existingChoreDoc = await getDocument(`families/${familyId}/chores/${choreId}`, idToken);
          const choreTitle = readString(existingChoreDoc.fields, "title") || "Untitled chore";
          const choreAssigneeId = readString(existingChoreDoc.fields, "assigneeId");
          const categories = await listFamilyCategories(familyId, idToken);
          const categoryMap = buildCategoryMap(categories);
          if (!hasAllCategoryIds(categoryIds, categoryMap)) {
            return { kind: "invalid_category_ids" as const };
          }
          await patchDocument(
            `families/${familyId}/chores/${choreId}`,
            {
              categoryIds: stringArrayField(categoryIds),
              updatedAt: timestampField(now),
            },
            idToken,
            ["categoryIds", "updatedAt"],
          );
          await emitFamilyActivity({
            familyId,
            idToken,
            kind: "chore_edited",
            actorUid: session.uid,
            actorEmail: session.email,
            actorName,
            title: "Chore categories updated",
            message: `${actorName} updated categories for "${choreTitle}".`,
            choreId,
            choreTitle,
            relatedIds: choreAssigneeId ? [choreAssigneeId] : [],
          });
          await publishFamilyActivity({
            type: "chore_updated",
            familyId,
            choreId,
            occurredAt: now,
          });
        } else {
          const requester = await getRequesterContext(
            familyId,
            session.uid,
            session.email,
            idToken,
          );
          if (requester.role !== "admin") {
            return { kind: "forbidden_action" as const };
          }
          const existingChoreDoc = await getDocument(`families/${familyId}/chores/${choreId}`, idToken);
          const previousAssigneeId = readString(existingChoreDoc.fields, "assigneeId");
          const previousTitle = readString(existingChoreDoc.fields, "title") || "Untitled chore";
          const choreSource = readString(existingChoreDoc.fields, "source");
          const choreGoogleTaskOwnerUid = readString(existingChoreDoc.fields, "googleTaskOwnerUid");
          const existingCategoryIds = readChoreCategoryIds(existingChoreDoc.fields);
          const categories = await listFamilyCategories(familyId, idToken);
          const categoryMap = buildCategoryMap(categories);
          const nextCategoryIds = hasCategoryIds ? categoryIds : existingCategoryIds;
          if (!hasAllCategoryIds(nextCategoryIds, categoryMap)) {
            return { kind: "invalid_category_ids" as const };
          }
          if (choreSource === GOOGLE_TASKS_CHORE_SOURCE && choreGoogleTaskOwnerUid) {
            syncOwnerUid = choreGoogleTaskOwnerUid;
          } else if (
            isRequesterAssignee(previousAssigneeId, session.uid, session.email) ||
            isRequesterAssignee(assigneeId, session.uid, session.email)
          ) {
            syncOwnerUid = session.uid;
          }
          if (assigneeId) {
            const activeChoreCount = await countActiveChoresForAssignee(
              familyId,
              assigneeId,
              idToken,
              choreId,
            );
            if (activeChoreCount >= MAX_ACTIVE_CHORES_PER_ASSIGNEE) {
              return { kind: "active_chore_limit_reached" as const };
            }
          }
          const resolvedAssigneeName = assigneeId
            ? await getFamilyMemberName(familyId, assigneeId, idToken)
            : "Unassigned";
          await patchDocument(
            `families/${familyId}/chores/${choreId}`,
            {
              title: stringField(normalizedDescription),
              assigneeId: stringField(assigneeId),
              assigneeName: stringField(resolvedAssigneeName),
              dueDate: stringField(dueDate),
              details: stringField(details),
              categoryIds: stringArrayField(nextCategoryIds),
              updatedAt: timestampField(now),
            },
            idToken,
            ["title", "assigneeId", "assigneeName", "dueDate", "details", "categoryIds", "updatedAt"],
          );
          await emitFamilyActivity({
            familyId,
            idToken,
            kind: "chore_edited",
            actorUid: session.uid,
            actorEmail: session.email,
            actorName,
            title: "Chore updated",
            message: `${actorName} updated "${normalizedDescription || previousTitle}".`,
            choreId,
            choreTitle: normalizedDescription || previousTitle,
            relatedIds: [assigneeId, previousAssigneeId].filter(Boolean),
          });
          await publishFamilyActivity({
            type: "chore_updated",
            familyId,
            choreId,
            occurredAt: now,
          });
        }

        if (syncOwnerUid) {
          await syncGoogleTasksForUser({
            uid: syncOwnerUid,
            idToken,
            force: true,
            minIntervalSeconds: 0,
          });
        }

        return { kind: "ok" as const };
      });

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "forbidden_action") {
      return NextResponse.json({ error: "forbidden_action" }, { status: 403 });
    }
    if (data.kind === "invalid_transition") {
      return NextResponse.json({ error: "invalid_status_transition" }, { status: 400 });
    }
    if (data.kind === "wallet_negative_blocked") {
      return NextResponse.json(
        { error: "wallet_negative_blocked", message: "Cannot undo completion after coins were spent." },
        { status: 409 },
      );
    }
    if (data.kind === "active_chore_limit_reached") {
      return NextResponse.json(
        { error: "active_chore_limit_reached", maxActiveChores: MAX_ACTIVE_CHORES_PER_ASSIGNEE },
        { status: 409 },
      );
    }
    if (data.kind === "invalid_category_ids") {
      return NextResponse.json({ error: "invalid_category_ids" }, { status: 400 });
    }

    const response = NextResponse.json({ success: true });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[CHORE_PATCH_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "update_chore_failed");
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ choreId: string }> },
) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  const { choreId } = await context.params;
  if (!choreId) {
    return NextResponse.json({ error: "chore_id_required" }, { status: 400 });
  }

  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        const familyId = await getPrimaryFamilyId(session.uid, idToken);
        if (!familyId) {
          return { kind: "family_not_found" as const };
        }
        const requester = await getRequesterContext(
          familyId,
          session.uid,
          session.email,
          idToken,
        );
        if (requester.role !== "admin") {
          return { kind: "forbidden_action" as const };
        }

        const existingChoreDoc = await getDocument(`families/${familyId}/chores/${choreId}`, idToken);
        const choreTitle = readString(existingChoreDoc.fields, "title") || "Untitled chore";
        const choreAssigneeId = readString(existingChoreDoc.fields, "assigneeId");
        const choreSource = readString(existingChoreDoc.fields, "source");
        const choreGoogleTaskOwnerUid = readString(existingChoreDoc.fields, "googleTaskOwnerUid");
        const now = new Date().toISOString();
        await patchDocument(
          `families/${familyId}/chores/${choreId}`,
          {
            deleted: boolField(true),
            deletedAt: timestampField(now),
            status: stringField("Deleted"),
            updatedAt: timestampField(now),
          },
          idToken,
          ["deleted", "deletedAt", "status", "updatedAt"],
        );
        await emitFamilyActivity({
          familyId,
          idToken,
          kind: "chore_deleted",
          actorUid: session.uid,
          actorEmail: session.email,
          actorName: session.name || session.email,
          title: "Chore deleted",
          message: `${session.name || "Someone"} deleted "${choreTitle}".`,
          choreId,
          choreTitle,
          relatedIds: choreAssigneeId ? [choreAssigneeId] : [],
        });
        await publishFamilyActivity({
          type: "chore_deleted",
          familyId,
          choreId,
          occurredAt: now,
        });
        if (choreSource === GOOGLE_TASKS_CHORE_SOURCE && choreGoogleTaskOwnerUid) {
          await syncGoogleTasksForUser({
            uid: choreGoogleTaskOwnerUid,
            idToken,
            force: true,
            minIntervalSeconds: 0,
          });
        } else if (isRequesterAssignee(choreAssigneeId, session.uid, session.email)) {
          await syncGoogleTasksForUser({
            uid: session.uid,
            idToken,
            force: true,
            minIntervalSeconds: 0,
          });
        }

        return { kind: "ok" as const };
      });

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "forbidden_action") {
      return NextResponse.json({ error: "forbidden_action" }, { status: 403 });
    }

    const response = NextResponse.json({ success: true });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[CHORE_SOFT_DELETE_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "delete_chore_failed");
  }
}
