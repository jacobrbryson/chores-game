import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  documentIdFromName,
  findFirstFamilyIdByMemberEmail,
  findFirstFamilyIdByMemberUid,
  type FirestoreValue,
  getDocument,
  listDocuments,
  patchDocument,
  readBoolean,
  readInteger,
  readString,
  readStringArray,
  readTimestamp,
  stringArrayField,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import { resolveMemberPrimaryColor } from "@/lib/theme/member-primary-color";
import { createFamilySocketAuthToken } from "@/lib/ws/family-auth-token";
import type { FamilySnapshotMember, FamilySummaryResponse } from "@/lib/family/types";
import {
  buildCategoryMap,
  listFamilyCategories,
  readChoreCategoryIds,
  resolveChoreCategories,
} from "@/lib/family/categories";
import { syncGoogleTasksForUser } from "@/lib/google/tasks-sync";

export const dynamic = "force-dynamic";
const MAX_FAMILY_MEMBERS = 100;
const MINUTE_MILLIS = 60 * 1000;
const MAX_SUMMARY_CHORES = 1000;

function toUnixMillis(value: string | undefined) {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseTimezoneOffsetMinutes(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return new Date().getTimezoneOffset();
  }
  const normalized = Math.trunc(parsed);
  return Math.max(-14 * 60, Math.min(14 * 60, normalized));
}

function toShiftedUtcMillis(value: number, timezoneOffsetMinutes: number) {
  return value - timezoneOffsetMinutes * MINUTE_MILLIS;
}

function localTodayIsoDate(timezoneOffsetMinutes: number) {
  return new Date(toShiftedUtcMillis(Date.now(), timezoneOffsetMinutes))
    .toISOString()
    .slice(0, 10);
}

function isFutureDueDate(value: string, todayIsoDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  return value > todayIsoDate;
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

function compareBySortOrderOrOldest(
  a: { sortOrder?: number; createdAt?: string; id: string },
  b: { sortOrder?: number; createdAt?: string; id: string },
) {
  const aHasSortOrder = typeof a.sortOrder === "number";
  const bHasSortOrder = typeof b.sortOrder === "number";
  const aSortOrder = aHasSortOrder ? (a.sortOrder as number) : -1;
  const bSortOrder = bHasSortOrder ? (b.sortOrder as number) : -1;
  if (aHasSortOrder && bHasSortOrder && aSortOrder !== bSortOrder) {
    return aSortOrder - bSortOrder;
  }
  if (aHasSortOrder && !bHasSortOrder) {
    return -1;
  }
  if (!aHasSortOrder && bHasSortOrder) {
    return 1;
  }
  const createdDiff = toUnixMillis(a.createdAt) - toUnixMillis(b.createdAt);
  if (createdDiff !== 0) {
    return createdDiff;
  }
  return a.id.localeCompare(b.id);
}

function toMemberRole(value: string | undefined): FamilySnapshotMember["role"] {
  return value === "admin" ? "admin" : "player";
}

function toMemberStatus(value: string | undefined): FamilySnapshotMember["status"] {
  return value === "active" ? "active" : "invited";
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function emptySummary(viewerUid: string, viewerGoogleTasksLinked = false): FamilySummaryResponse {
  return {
    viewerUid,
    viewerGoogleTasksLinked,
    wsAuthToken: "",
    noFamily: true,
    family: null,
    members: [],
    categories: [],
    choresToday: [],
    pendingInvite: null,
  };
}

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

function jsonFirestoreNotConfigured() {
  return NextResponse.json(
    {
      error: "firestore_not_configured",
      message:
        "Cloud Firestore default database is not configured for this project.",
    },
    { status: 503 },
  );
}

async function relinkUserPrimaryFamily(uid: string, familyId: string, idToken: string) {
  const now = new Date().toISOString();
  await patchDocument(
    `users/${uid}`,
    {
      uid: stringField(uid),
      familyIds: stringArrayField([familyId]),
      lastFamilyUpdateAt: timestampField(now),
    },
    idToken,
    ["familyIds", "lastFamilyUpdateAt", "uid"],
  );
}

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }
  const timezoneOffsetMinutes = parseTimezoneOffsetMinutes(
    request.nextUrl.searchParams.get("tzOffsetMinutes"),
  );
  const todayIsoDate = localTodayIsoDate(timezoneOffsetMinutes);

  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        let userDoc: Awaited<ReturnType<typeof getDocument>> | null = null;
        try {
          userDoc = await getDocument(`users/${session.uid}`, idToken);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "";
          if (
            reason.includes("FIRESTORE_HTTP_404") &&
            reason.toLowerCase().includes("document") &&
            reason.toLowerCase().includes("not found")
          ) {
            userDoc = null;
          } else {
            throw error;
          }
        }

        const familyIds = readStringArray(userDoc?.fields, "familyIds");
        const viewerGoogleTasksLinked = readBoolean(userDoc?.fields, "googleTasksLinked");
        let familyId = familyIds[0];
        if (!familyId) {
          let inviteLookupFamilyId = "";
          if (session.email) {
            try {
              const inviteLookupDoc = await getDocument(
                `inviteLookup/${session.email.trim().toLowerCase()}`,
                idToken,
              );
              const status = readString(inviteLookupDoc.fields, "status");
              const candidateFamilyId = readString(inviteLookupDoc.fields, "familyId");
              if ((status === "invited" || status === "claimed") && candidateFamilyId) {
                inviteLookupFamilyId = candidateFamilyId;
              }
            } catch (error) {
              const reason = error instanceof Error ? error.message : "";
              if (!reason.includes("FIRESTORE_HTTP_404")) {
                throw error;
              }
            }
          }
          const uidRecoveredFamilyId = await findFirstFamilyIdByMemberUid(session.uid, idToken);
          const emailRecoveredFamilyId = uidRecoveredFamilyId || inviteLookupFamilyId
            ? ""
            : await findFirstFamilyIdByMemberEmail(session.email, idToken);
          const recoveredFamilyId =
            uidRecoveredFamilyId || inviteLookupFamilyId || emailRecoveredFamilyId;
          if (!recoveredFamilyId) {
            return emptySummary(session.uid, viewerGoogleTasksLinked);
          }
          familyId = recoveredFamilyId;
          await relinkUserPrimaryFamily(session.uid, familyId, idToken);
        }

        await syncGoogleTasksForUser({
          uid: session.uid,
          idToken,
          minIntervalSeconds: 60,
        });

        const [familyDoc, memberDocs, choreDocs, categories] = await Promise.all([
          getDocument(`families/${familyId}`, idToken),
          listDocuments(`families/${familyId}/members`, idToken, 100),
          listDocuments(`families/${familyId}/chores`, idToken, MAX_SUMMARY_CHORES),
          listFamilyCategories(familyId, idToken),
        ]);
        const categoryMap = buildCategoryMap(categories);

        const rawMemberCount = memberDocs.length;
        const familyName = readString(familyDoc.fields, "name") || "My Family";

        const rawMembers = memberDocs
          .map((doc) => ({
            id: documentIdFromName(doc.name),
            uid: readString(doc.fields, "uid") || undefined,
            name: readString(doc.fields, "name") || "Unnamed member",
            email: readString(doc.fields, "email"),
            dashboardPrimaryColor: readString(doc.fields, "dashboardPrimaryColor") || undefined,
            avatarId: readString(doc.fields, "avatarId") || undefined,
            avatarPhotoUrl: readString(doc.fields, "avatarPhotoUrl") || undefined,
            role: toMemberRole(readString(doc.fields, "role")),
            status: toMemberStatus(readString(doc.fields, "status")),
            lastSignInAt: readTimestamp(doc.fields, "lastSignInAt") || undefined,
            createdBy: readString(doc.fields, "createdBy"),
            createdAt: readTimestamp(doc.fields, "createdAt") || undefined,
            deleted: readBoolean(doc.fields, "deleted"),
          }))
          .filter((member) => !member.deleted);

        const assigneeColorByAlias = new Map<string, string>();
        const assigneeAvatarByAlias = new Map<string, string>();
        const assigneeAvatarPhotoByAlias = new Map<string, string>();
        for (const member of rawMembers) {
          const resolvedColor = resolveMemberPrimaryColor(member.dashboardPrimaryColor);
          assigneeColorByAlias.set(member.id, resolvedColor);
          if (member.avatarId) {
            assigneeAvatarByAlias.set(member.id, member.avatarId);
          }
          if (member.avatarPhotoUrl) {
            assigneeAvatarPhotoByAlias.set(member.id, member.avatarPhotoUrl);
          }
          if (member.uid) {
            assigneeColorByAlias.set(member.uid, resolvedColor);
            if (member.avatarId) {
              assigneeAvatarByAlias.set(member.uid, member.avatarId);
            }
            if (member.avatarPhotoUrl) {
              assigneeAvatarPhotoByAlias.set(member.uid, member.avatarPhotoUrl);
            }
          }
          if (member.email) {
            const normalizedEmail = normalizeEmail(member.email);
            assigneeColorByAlias.set(normalizedEmail, resolvedColor);
            if (member.avatarId) {
              assigneeAvatarByAlias.set(normalizedEmail, member.avatarId);
            }
            if (member.avatarPhotoUrl) {
              assigneeAvatarPhotoByAlias.set(normalizedEmail, member.avatarPhotoUrl);
            }
          }
        }

        const normalizedSessionEmail = session.email.trim().toLowerCase();
        const viewerMember =
          rawMembers.find((member) => member.uid === session.uid) ||
          rawMembers.find(
            (member) => !member.uid && member.email.trim().toLowerCase() === normalizedSessionEmail,
          );
        if (viewerMember?.status === "invited") {
          const inviter =
            rawMembers.find(
              (member) => member.uid === viewerMember.createdBy || member.id === viewerMember.createdBy,
            ) ?? null;
          const pendingSummary: FamilySummaryResponse = {
            viewerUid: session.uid,
            viewerGoogleTasksLinked,
            wsAuthToken: createFamilySocketAuthToken({
              uid: session.uid,
              familyIds: [familyId],
            }),
            noFamily: false,
            family: {
              id: familyId,
              name: familyName,
            },
            members: inviter
              ? [
                  {
                    id: inviter.id,
                    uid: inviter.uid,
                    name: inviter.name,
                    email: inviter.email,
                    role: inviter.role,
                    status: inviter.status,
                    lastSignInAt: inviter.lastSignInAt,
                    dashboardPrimaryColor: resolveMemberPrimaryColor(inviter.dashboardPrimaryColor),
                    avatarId: inviter.avatarId,
                    avatarPhotoUrl: inviter.avatarPhotoUrl,
                  },
                ]
              : [],
            categories: [],
            choresToday: [],
            pendingInvite: {
              familyId,
              familyName,
              invitedEmail: viewerMember.email || normalizedSessionEmail,
              invitedAt: viewerMember.createdAt,
              inviter: inviter
                ? {
                    id: inviter.id,
                    name: inviter.name,
                    email: inviter.email,
                  }
                : null,
            },
          };
          return pendingSummary;
        }

        const mappedMembers = rawMembers
          .filter((member, _index, members) => {
            if (member.uid) {
              return true;
            }
            const normalizedEmail = member.email.trim().toLowerCase();
            if (!normalizedEmail) {
              return true;
            }
            return !members.some(
              (candidate) =>
                Boolean(candidate.uid) &&
                candidate.email.trim().toLowerCase() === normalizedEmail,
            );
          })
          .sort((a, b) => {
            const aIsViewer = a.id === session.uid || a.uid === session.uid;
            const bIsViewer = b.id === session.uid || b.uid === session.uid;
            if (aIsViewer && !bIsViewer) {
              return -1;
            }
            if (!aIsViewer && bIsViewer) {
              return 1;
            }
            return toUnixMillis(b.lastSignInAt) - toUnixMillis(a.lastSignInAt);
          })
          .map((member) => ({
            id: member.id,
            uid: member.uid,
            name: member.name,
            email: member.email,
            role: member.role,
            status: member.status,
            lastSignInAt: member.lastSignInAt,
            dashboardPrimaryColor: resolveMemberPrimaryColor(member.dashboardPrimaryColor),
            avatarId: member.avatarId,
            avatarPhotoUrl: member.avatarPhotoUrl,
          }))
          .slice(0, MAX_FAMILY_MEMBERS);

        return {
          viewerUid: session.uid,
          viewerGoogleTasksLinked,
          wsAuthToken: createFamilySocketAuthToken({
            uid: session.uid,
            familyIds: [familyId],
          }),
          noFamily: false,
          family: {
            id: familyId,
            name: familyName,
          },
          members: mappedMembers,
          categories,
          choresToday: choreDocs
            .map((doc) => ({
              id: documentIdFromName(doc.name),
              title: readString(doc.fields, "title") || "Untitled chore",
              status: readString(doc.fields, "status"),
              assigneeId: readString(doc.fields, "assigneeId") || undefined,
              assigneeName: readString(doc.fields, "assigneeName") || "Unassigned",
              assigneePrimaryColor:
                assigneeColorByAlias.get(readString(doc.fields, "assigneeId")) ||
                assigneeColorByAlias.get(
                  normalizeEmail(readString(doc.fields, "assigneeId")),
                ) ||
                undefined,
              assigneeAvatarId:
                assigneeAvatarByAlias.get(readString(doc.fields, "assigneeId")) ||
                assigneeAvatarByAlias.get(
                  normalizeEmail(readString(doc.fields, "assigneeId")),
                ) ||
                undefined,
              assigneeAvatarPhotoUrl:
                assigneeAvatarPhotoByAlias.get(readString(doc.fields, "assigneeId")) ||
                assigneeAvatarPhotoByAlias.get(
                  normalizeEmail(readString(doc.fields, "assigneeId")),
                ) ||
                undefined,
              dueDate: readString(doc.fields, "dueDate"),
              details: readString(doc.fields, "details") || undefined,
              categoryIds: readChoreCategoryIds(doc.fields),
              deleted: readBoolean(doc.fields, "deleted"),
              coinValue: readInteger(doc.fields, "coinValue") || 10,
              source:
                readString(doc.fields, "source") === "google_tasks"
                  ? ("google_tasks" as const)
                  : ("manual" as const),
              sortOrder: readOptionalSortOrder(doc.fields),
              createdAt: readTimestamp(doc.fields, "createdAt") || undefined,
            }))
            .filter(
              (chore) =>
                !chore.deleted &&
                chore.status === "Open" &&
                !isFutureDueDate(chore.dueDate, todayIsoDate),
            )
            .sort(compareBySortOrderOrOldest)
            .map((chore) => ({
              id: chore.id,
              title: chore.title,
              sortOrder: chore.sortOrder,
              createdAt: chore.createdAt,
              assigneeId: chore.assigneeId,
              assigneeName: chore.assigneeName,
              assigneePrimaryColor: chore.assigneePrimaryColor,
              assigneeAvatarId: chore.assigneeAvatarId,
              assigneeAvatarPhotoUrl: chore.assigneeAvatarPhotoUrl,
              dueDate: chore.dueDate,
              details: chore.details,
              categoryIds: chore.categoryIds,
              categories: resolveChoreCategories(chore.categoryIds, categoryMap),
              coinValue: chore.coinValue,
              source: chore.source,
              status:
                chore.status === "Open" ||
                chore.status === "Submitted" ||
                chore.status === "Approved" ||
                chore.status === "Rejected"
                  ? chore.status
                  : "Unknown",
            })),
          pendingInvite: null,
        } satisfies FamilySummaryResponse;
      });

    let nextSession = refreshedSession;
    let shouldSetSessionCookie = refreshed;
    const resolvedViewerRole =
      data.members.find((member) => member.uid === data.viewerUid || member.id === data.viewerUid)
        ?.role ?? "player";
    if (resolvedViewerRole !== refreshedSession.role) {
      nextSession = { ...refreshedSession, role: resolvedViewerRole };
      shouldSetSessionCookie = true;
    }

    const response = NextResponse.json(data);
    if (shouldSetSessionCookie) {
      setSessionUserCookie(response, nextSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 160) : "unknown";
    console.error("[FAMILY_SUMMARY_ERROR]", reason);
    if (
      reason.includes("FIRESTORE_HTTP_404") &&
      reason.toLowerCase().includes("database (default) does not exist")
    ) {
      return jsonFirestoreNotConfigured();
    }
    if (
      reason.includes("FIRESTORE_HTTP_401")
    ) {
      return jsonReauthRequired();
    }
    if (reason.includes("FIREBASE_REFRESH_FAILED")) {
      return jsonReauthRequired();
    }
    if (reason.includes("FIRESTORE_HTTP_403")) {
      return jsonFirestoreForbidden();
    }
    return NextResponse.json({ error: "summary_unavailable" }, { status: 500 });
  }
}
















