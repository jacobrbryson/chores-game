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
import {
  normalizeCoinValue,
  normalizeRecurrenceConfig,
} from "@/lib/chores/recurrence";

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

function createEmptyMemberStats() {
  return {
    lifetimeChoresCompleted: 0,
    lifetimeCoinsEarned: 0,
    currentCoins: 0,
  };
}

function resolveMemberStatsKey(member: {
  id: string;
  uid?: string;
  email: string;
}) {
  return member.uid || normalizeEmail(member.email) || member.id;
}

function buildViewerAssigneeAliases(
  memberDocs: Array<{ name: string; fields?: Record<string, FirestoreValue> }>,
  uid: string,
  email: string,
) {
  const aliases = new Set<string>();
  aliases.add(uid);
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail) {
    aliases.add(normalizedEmail);
  }

  for (const memberDoc of memberDocs) {
    if (readBoolean(memberDoc.fields, "deleted")) {
      continue;
    }
    const memberId = documentIdFromName(memberDoc.name);
    const memberUid = readString(memberDoc.fields, "uid");
    const memberEmail = normalizeEmail(readString(memberDoc.fields, "email"));
    const matchesUid = memberId === uid || memberUid === uid;
    const matchesEmail = Boolean(normalizedEmail) && memberEmail === normalizedEmail;
    if (!matchesUid && !matchesEmail) {
      continue;
    }
    aliases.add(memberId);
    if (memberUid) {
      aliases.add(memberUid);
    }
    if (memberEmail) {
      aliases.add(memberEmail);
    }
  }

  return Array.from(aliases);
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
        const viewerAssigneeAliases = buildViewerAssigneeAliases(
          memberDocs,
          session.uid,
          session.email,
        );
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

        const normalizedSessionEmail = session.email.trim().toLowerCase();
        const viewerMember =
          rawMembers.find((member) => member.uid === session.uid) ||
          rawMembers.find((member) => member.id === session.memberId) ||
          rawMembers.find((member) => member.id === session.uid) ||
          rawMembers.find(
            (member) => !member.uid && member.email.trim().toLowerCase() === normalizedSessionEmail,
          );
        const viewerRole = viewerMember?.role ?? "player";

        const memberStatsByKey = new Map<
          string,
          ReturnType<typeof createEmptyMemberStats>
        >();
        const memberStatsKeyByAlias = new Map<string, string>();
        const memberUserDocByUid = new Map<
          string,
          Awaited<ReturnType<typeof getDocument>> | null
        >();

        for (const member of rawMembers) {
          const statsKey = resolveMemberStatsKey(member);
          memberStatsByKey.set(statsKey, createEmptyMemberStats());
          memberStatsKeyByAlias.set(member.id, statsKey);
          if (member.uid) {
            memberStatsKeyByAlias.set(member.uid, statsKey);
          }
          if (member.email) {
            memberStatsKeyByAlias.set(normalizeEmail(member.email), statsKey);
          }
        }

        await Promise.all(
          rawMembers.map(async (member) => {
            if (!member.uid) {
              return;
            }
            if (viewerRole !== "admin" && member.uid !== session.uid) {
              return;
            }
            try {
              const currentUserDoc =
                member.uid === session.uid
                  ? userDoc
                  : await getDocument(`users/${member.uid}`, idToken);
              memberUserDocByUid.set(member.uid, currentUserDoc);
            } catch (error) {
              const reason = error instanceof Error ? error.message : "";
              if (reason.includes("FIRESTORE_HTTP_404")) {
                memberUserDocByUid.set(member.uid, null);
                return;
              }
              throw error;
            }
          }),
        );

        for (const member of rawMembers) {
          const statsKey = resolveMemberStatsKey(member);
          const currentStats = memberStatsByKey.get(statsKey);
          if (!currentStats || !member.uid) {
            continue;
          }
          currentStats.currentCoins = readInteger(
            memberUserDocByUid.get(member.uid)?.fields,
            "walletBalance",
          );
        }

        for (const doc of choreDocs) {
          if (readBoolean(doc.fields, "deleted")) {
            continue;
          }
          const assigneeId = readString(doc.fields, "assigneeId");
          const statsKey =
            memberStatsKeyByAlias.get(assigneeId) ||
            memberStatsKeyByAlias.get(normalizeEmail(assigneeId));
          if (!statsKey) {
            continue;
          }
          const currentStats = memberStatsByKey.get(statsKey);
          if (!currentStats) {
            continue;
          }
          const choreStatus = readString(doc.fields, "status");
          const choreRequireApproval = readBoolean(doc.fields, "requireApproval");
          if (choreStatus === "Submitted" || choreStatus === "Approved") {
            currentStats.lifetimeChoresCompleted += 1;
          }
          if (choreStatus === "Approved" || (choreStatus === "Submitted" && !choreRequireApproval)) {
            currentStats.lifetimeCoinsEarned += normalizeCoinValue(
              readInteger(doc.fields, "coinValue"),
            );
          }
        }

        for (const member of rawMembers) {
          const statsKey = resolveMemberStatsKey(member);
          const currentStats = memberStatsByKey.get(statsKey);
          if (!currentStats) {
            continue;
          }
          currentStats.lifetimeCoinsEarned = Math.max(
            currentStats.lifetimeCoinsEarned,
            currentStats.currentCoins,
          );
        }

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
                    stats:
                      memberStatsByKey.get(resolveMemberStatsKey(inviter)) ??
                      createEmptyMemberStats(),
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
            stats:
              memberStatsByKey.get(resolveMemberStatsKey(member)) ??
              createEmptyMemberStats(),
          }))
          .slice(0, MAX_FAMILY_MEMBERS);

        return {
          viewerUid: session.uid,
          viewerAssigneeAliases,
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
              assigneeIds: readStringArray(doc.fields, "assigneeIds"),
              assigneeScope:
                readString(doc.fields, "assigneeScope") === "family"
                  ? "family"
                  : readString(doc.fields, "assigneeScope") === "multiple"
                    ? "multiple"
                    : "single",
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
              coinValue: normalizeCoinValue(readInteger(doc.fields, "coinValue")),
              requireApproval: readBoolean(doc.fields, "requireApproval"),
              recurrence: normalizeRecurrenceConfig({
                recurrenceType: readString(doc.fields, "recurrenceType"),
                recurrenceInterval: readInteger(doc.fields, "recurrenceInterval"),
                recurrenceUnit: readString(doc.fields, "recurrenceUnit"),
              }),
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
              assigneeIds: chore.assigneeIds,
              assigneeScope: chore.assigneeScope,
              assigneeName: chore.assigneeName,
              assigneePrimaryColor: chore.assigneePrimaryColor,
              assigneeAvatarId: chore.assigneeAvatarId,
              assigneeAvatarPhotoUrl: chore.assigneeAvatarPhotoUrl,
              dueDate: chore.dueDate,
              details: chore.details,
              categoryIds: chore.categoryIds,
              categories: resolveChoreCategories(chore.categoryIds, categoryMap),
              coinValue: chore.coinValue,
              requireApproval: chore.requireApproval,
              recurrenceType: chore.recurrence.recurrenceType,
              recurrenceInterval: chore.recurrence.recurrenceInterval,
              recurrenceUnit: chore.recurrence.recurrenceUnit,
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
    const resolvedViewerMember =
      data.members.find(
        (member) =>
          member.uid === data.viewerUid ||
          member.id === refreshedSession.memberId ||
          member.id === data.viewerUid,
      ) ?? null;
    const resolvedViewerRole = resolvedViewerMember?.role ?? "player";
    const resolvedViewerMemberId = resolvedViewerMember?.id ?? refreshedSession.memberId ?? refreshedSession.uid;
    if (resolvedViewerRole !== refreshedSession.role || resolvedViewerMemberId !== refreshedSession.memberId) {
      nextSession = {
        ...refreshedSession,
        role: resolvedViewerRole,
        memberId: resolvedViewerMemberId,
      };
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
















