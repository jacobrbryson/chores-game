import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { formatServerTiming } from "@/lib/observability/request-context";
import { runAfterResponse } from "@/lib/async/after-response";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import { keyableEmail } from "@/lib/auth/private-relay";
import {
  documentIdFromName,
  findFirstFamilyIdByMemberUid,
  type FirestoreDocument,
  type FirestoreValue,
  getDocument,
  listAllDocuments,
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
import { adminGetDocument } from "@/lib/firestore/admin";
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
import {
  canonicalRecurringChoreId,
  loadClaimedSkillBonusKeys,
  NEW_SKILL_BONUS_AMOUNT,
  skillBonusEligibilityKey,
} from "@/lib/chores/skill-bonus";
import { normalizeChoreType } from "@/lib/chores/types";
import { loadResponsibilityConfig } from "@/lib/responsibility/config";
import { levelForXp } from "@/lib/responsibility/levels";
import { pillarXpFieldName } from "@/lib/responsibility/service";
import { titleProgressForPillar, titleUnlockTier } from "@/lib/responsibility/titles";
import { normalizeResponsibilityPillar, type ResponsibilityPillar } from "@/lib/responsibility/types";
import { rolloverOverdueRoutineAssignmentsBestEffort } from "@/lib/responsibility/assignment-service";
import { DEFAULT_LOCALE, resolveAppLocale } from "@/lib/locale";

export const dynamic = "force-dynamic";
const MAX_FAMILY_MEMBERS = 100;
const MAX_SUMMARY_CHORES = 5000;
const MINUTE_MILLIS = 60 * 1000;

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

function offsetIsoDateAt(value: number, timezoneOffsetMinutes: number) {
  return new Date(toShiftedUtcMillis(value, timezoneOffsetMinutes))
    .toISOString()
    .slice(0, 10);
}

function isAfterLocalToday(
  dueDate: string,
  timezoneOffsetMinutes: number,
  nowMillis = Date.now(),
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return false;
  }
  const todayIsoDate = offsetIsoDateAt(nowMillis, timezoneOffsetMinutes);
  return dueDate > todayIsoDate;
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

function parseAssigneeScope(value: string): "single" | "multiple" | "family" {
  if (value === "family") {
    return "family";
  }
  if (value === "multiple") {
    return "multiple";
  }
  return "single";
}

function createEmptyMemberStats() {
  return {
    lifetimeChoresCompleted: 0,
    lifetimeCoinsEarned: 0,
    currentCoins: 0,
  };
}

type ResponsibilityProgressProjection = NonNullable<
  FamilySummaryResponse["choresToday"][number]["responsibilityProgress"]
>;

function resolveSingleAssigneeUid(
  chore: {
    assigneeId?: string;
    assigneeIds?: string[];
    assigneeScope?: "single" | "multiple" | "family";
  },
  memberUidByAlias: Map<string, string>,
) {
  if (chore.assigneeScope === "family" || (chore.assigneeIds?.length ?? 0) > 1) {
    return "";
  }
  const assigneeId =
    chore.assigneeIds && chore.assigneeIds.length === 1
      ? chore.assigneeIds[0]
      : chore.assigneeId || "";
  return memberUidByAlias.get(assigneeId) || memberUidByAlias.get(normalizeEmail(assigneeId)) || "";
}

function buildResponsibilityProgressProjection(input: {
  playerId: string;
  pillar: ResponsibilityPillar | undefined;
  progressFields: Record<string, FirestoreValue> | undefined;
  choreXpAwarded: number;
  newSkillXpAwarded: number;
  levelThresholds: number[];
}): ResponsibilityProgressProjection | undefined {
  const { playerId, pillar, progressFields, choreXpAwarded, newSkillXpAwarded, levelThresholds } = input;
  if (!playerId || !pillar) {
    return undefined;
  }
  const xpAwarded = Math.max(0, choreXpAwarded + newSkillXpAwarded);
  if (xpAwarded <= 0) {
    return undefined;
  }
  const xpBefore = Math.max(0, readInteger(progressFields, pillarXpFieldName(pillar)));
  const xpAfter = xpBefore + xpAwarded;
  const beforeTitle = titleProgressForPillar({ xp: xpBefore, thresholds: levelThresholds });
  const afterTitle = titleProgressForPillar({ xp: xpAfter, thresholds: levelThresholds });
  return {
    playerId,
    pillar,
    xpBefore,
    xpAfter,
    levelBefore: levelForXp(xpBefore, levelThresholds),
    levelAfter: levelForXp(xpAfter, levelThresholds),
    tier: afterTitle.tier,
    nextTier: afterTitle.nextTier,
    prevFraction: beforeTitle.titleProgressFraction,
    newFraction: afterTitle.titleProgressFraction,
    unlocked: titleUnlockTier(xpBefore, xpAfter, levelThresholds) !== null,
    xpAwarded,
  };
}

function isFirestoreNotFound(error: unknown) {
  const reason = error instanceof Error ? error.message : "";
  return reason.includes("FIRESTORE_HTTP_404") || reason.includes("FIRESTORE_ADMIN_HTTP_404");
}

function isFirestoreForbidden(error: unknown) {
  const reason = error instanceof Error ? error.message : "";
  return reason.includes("FIRESTORE_HTTP_403") || reason.includes("PERMISSION_DENIED");
}

async function getSummaryUserDoc(
  uid: string,
  idToken: string,
  currentSessionUid: string,
  currentUserDoc: FirestoreDocument | null,
) {
  if (uid === currentSessionUid) {
    return currentUserDoc;
  }
  try {
    return await getDocument(`users/${uid}`, idToken);
  } catch (error) {
    if (isFirestoreNotFound(error)) {
      return null;
    }
    if (!isFirestoreForbidden(error)) {
      throw error;
    }
  }

  try {
    return await adminGetDocument(`users/${uid}`);
  } catch (error) {
    if (isFirestoreNotFound(error)) {
      return null;
    }
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("ADMIN_CREDENTIALS_UNAVAILABLE")) {
      return null;
    }
    throw error;
  }
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

function emptySummary(
  viewerUid: string,
  viewerGoogleTasksLinked = false,
  resolvedLocale = DEFAULT_LOCALE,
): FamilySummaryResponse {
  return {
    viewerUid,
    viewerGoogleTasksLinked,
    resolvedLocale,
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
  try {
    const { data, session: refreshedSession, refreshed, timing } =
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
          // Recovery is uid-only since the email-keying migration. The former
          // inviteLookup/{email} and member-email fallbacks could never match an
          // Apple private-relay address, and matching on an address is what let
          // a second Google account land in someone else's family.
          const recoveredFamilyId = await findFirstFamilyIdByMemberUid(session.uid, idToken);
          if (!recoveredFamilyId) {
            return emptySummary(
              session.uid,
              viewerGoogleTasksLinked,
              resolveAppLocale({ sessionLocale: session.locale }),
            );
          }
          familyId = recoveredFamilyId;
          await relinkUserPrimaryFamily(session.uid, familyId, idToken);
        }

        // Skip the sync entirely for the majority of users who have never linked
        // Google Tasks — it makes external Google API calls plus its own archive
        // read, and blocked every dashboard load. `/api/chores` has gated this
        // since its own performance pass; this is the backport of that fix.
        if (viewerGoogleTasksLinked) {
          await runAfterResponse("summary:google-tasks-sync", () =>
            syncGoogleTasksForUser({
              uid: session.uid,
              idToken,
              minIntervalSeconds: 60,
            }),
          );
        }

        // Rolling overdue routine assignments forward is a write loop on a read
        // path. Deferred past the response so the dashboard is not waiting on it.
        // Trade-off: the first load after an assignment goes overdue renders the
        // pre-rollover due date, and the next load shows it rolled forward.
        await runAfterResponse("summary:routine-rollover", () =>
          rolloverOverdueRoutineAssignmentsBestEffort({
            familyId,
            idToken,
            today: offsetIsoDateAt(Date.now(), timezoneOffsetMinutes),
            actor: { uid: session.uid, email: session.email, name: session.name },
          }),
        );

        const [familyDoc, memberDocs, choreDocs, categories, claimedSkillBonusKeys] =
          await Promise.all([
            getDocument(`families/${familyId}`, idToken),
            listDocuments(`families/${familyId}/members`, idToken, 100),
            listAllDocuments(`families/${familyId}/chores`, idToken, { cap: MAX_SUMMARY_CHORES }),
            listFamilyCategories(familyId, idToken),
            loadClaimedSkillBonusKeys(familyId, idToken),
          ]);
        const viewerAssigneeAliases = buildViewerAssigneeAliases(
          memberDocs,
          session.uid,
          session.email,
        );
        const categoryMap = buildCategoryMap(categories);

        const familyName = readString(familyDoc.fields, "name") || "My Family";
        const familyLocale = resolveAppLocale({
          familyLocale: readString(familyDoc.fields, "defaultLocale"),
        });

        const rawMembers = memberDocs
          .map((doc) => ({
            id: documentIdFromName(doc.name),
            uid: readString(doc.fields, "uid") || undefined,
            name: readString(doc.fields, "name") || "Unnamed member",
            email: readString(doc.fields, "email"),
            pendingEmail: readString(doc.fields, "pendingEmail") || undefined,
            locale: readString(doc.fields, "locale") || undefined,
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

        // Maps every assignee alias (member id, uid, email) to the member's
        // canonical Firebase uid so per-chore New Skill Bonus eligibility can be
        // resolved against the durable claim records.
        const assigneeUidByAlias = new Map<string, string>();
        for (const member of rawMembers) {
          if (!member.uid) {
            continue;
          }
          assigneeUidByAlias.set(member.id, member.uid);
          assigneeUidByAlias.set(member.uid, member.uid);
          const normalizedMemberEmail = normalizeEmail(member.email);
          if (normalizedMemberEmail) {
            assigneeUidByAlias.set(normalizedMemberEmail, member.uid);
          }
        }
        // Eligibility is only computed for clearly single-assignee chores: for
        // multi/family chores assignees differ per child, so we omit the badge
        // rather than risk promising a bonus the viewing child won't get.
        function resolveNewSkillBonusEligible(
          fields: Record<string, FirestoreValue> | undefined,
          choreId: string,
          choreType: string,
          assigneeScope: "single" | "multiple" | "family",
          assigneeId: string,
        ) {
          const newSkillEnabled =
            !fields || !Object.prototype.hasOwnProperty.call(fields, "newSkillEnabled")
              ? true
              : readBoolean(fields, "newSkillEnabled");
          if (assigneeScope !== "single" || choreType === "see_and_do" || !newSkillEnabled) {
            return false;
          }
          const assigneeUid =
            assigneeUidByAlias.get(assigneeId) ||
            assigneeUidByAlias.get(normalizeEmail(assigneeId)) ||
            "";
          if (!assigneeUid) {
            return false;
          }
          const rootChoreId = canonicalRecurringChoreId(fields, choreId);
          return !claimedSkillBonusKeys.has(
            skillBonusEligibilityKey(assigneeUid, rootChoreId),
          );
        }

        const normalizedSessionEmail = session.email.trim().toLowerCase();
        const viewerMember =
          rawMembers.find((member) => member.uid === session.uid) ||
          rawMembers.find((member) => member.id === session.memberId) ||
          rawMembers.find((member) => member.id === session.uid) ||
          rawMembers.find(
            (member) => !member.uid && member.email.trim().toLowerCase() === normalizedSessionEmail,
          );

        const memberStatsByKey = new Map<
          string,
          ReturnType<typeof createEmptyMemberStats>
        >();
        const memberStatsKeyByAlias = new Map<string, string>();
        const memberUidByAlias = new Map<string, string>();
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
            memberUidByAlias.set(member.id, member.uid);
            memberUidByAlias.set(member.uid, member.uid);
          }
          if (member.email) {
            const normalizedMemberEmail = normalizeEmail(member.email);
            memberStatsKeyByAlias.set(normalizedMemberEmail, statsKey);
            if (member.uid) {
              memberUidByAlias.set(normalizedMemberEmail, member.uid);
            }
          }
        }

        await Promise.all(
          rawMembers.map(async (member) => {
            if (!member.uid) {
              return;
            }
            const currentUserDoc = await getSummaryUserDoc(
              member.uid,
              idToken,
              session.uid,
              userDoc,
            );
            memberUserDocByUid.set(member.uid, currentUserDoc);
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

        await Promise.all(
          rawMembers.map(async (member) => {
            const statsKey = resolveMemberStatsKey(member);
            const currentStats = memberStatsByKey.get(statsKey);
            if (!currentStats) {
              return;
            }
            let ledgerLifetimeCoinsEarned = 0;
            if (member.uid) {
              try {
                // Runs once per family member, paging up to 1000 ledger entries
                // each, to derive a single integer. Masking to the three fields
                // the reducer below actually reads keeps the payload proportional
                // to the arithmetic instead of to the full ledger history.
                // (The durable fix is a denormalized lifetime counter on the
                // member document — see Phase 4 item 1.)
                const ledgerDocs = await listAllDocuments(
                  `users/${member.uid}/walletLedger`,
                  idToken,
                  { cap: 1000, mask: ["countsTowardBalance", "creditAmount", "delta"] },
                );
                ledgerLifetimeCoinsEarned = ledgerDocs.reduce((total, ledgerDoc) => {
                  if (readBoolean(ledgerDoc.fields, "countsTowardBalance") === false) {
                    return total;
                  }
                  const creditAmount = readInteger(ledgerDoc.fields, "creditAmount");
                  if (creditAmount > 0) {
                    return total + creditAmount;
                  }
                  const delta = readInteger(ledgerDoc.fields, "delta");
                  return delta > 0 ? total + delta : total;
                }, 0);
              } catch (error) {
                const reason = error instanceof Error ? error.message : "";
                if (!reason.includes("FIRESTORE_HTTP_404")) {
                  throw error;
                }
              }
            }
            currentStats.lifetimeCoinsEarned = Math.max(
              currentStats.lifetimeCoinsEarned,
              ledgerLifetimeCoinsEarned,
              currentStats.currentCoins,
            );
          }),
        );

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
        const responsibilityConfig = await loadResponsibilityConfig();
        const responsibilityProgressFieldsByPlayer = new Map<
          string,
          Record<string, FirestoreValue> | undefined
        >();
        try {
          const progressDocs = await listAllDocuments(
            `families/${familyId}/responsibilityProgress`,
            idToken,
            { cap: 200 },
          );
          for (const progressDoc of progressDocs) {
            const playerId =
              readString(progressDoc.fields, "playerId") || documentIdFromName(progressDoc.name);
            if (playerId) {
              responsibilityProgressFieldsByPlayer.set(playerId, progressDoc.fields);
            }
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : "";
          if (!reason.includes("FIRESTORE_HTTP_404")) {
            throw error;
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
            resolvedLocale: resolveAppLocale({
              sessionLocale: session.locale,
              memberLocale: viewerMember?.locale,
              familyLocale,
            }),
            wsAuthToken: createFamilySocketAuthToken({
              uid: session.uid,
              familyIds: [familyId],
            }),
            noFamily: false,
            family: {
              id: familyId,
              name: familyName,
              defaultLocale: familyLocale,
            },
            members: inviter
              ? [
                  {
                    id: inviter.id,
                    uid: inviter.uid,
                    name: inviter.name,
                    email: inviter.email,
                    locale:
                      inviter.locale === "es-US"
                        ? "es-US"
                        : inviter.locale === "en-US"
                          ? "en-US"
                          : undefined,
                    resolvedLocale: resolveAppLocale({
                      memberLocale: inviter.locale,
                      familyLocale,
                    }),
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

        const mappedMembers: FamilySummaryResponse["members"] = rawMembers
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
          .map((member) => {
            const memberLocale: FamilySummaryResponse["members"][number]["locale"] =
              member.locale === "es-US"
                ? "es-US"
                : member.locale === "en-US"
                  ? "en-US"
                  : undefined;
            return {
              id: member.id,
              uid: member.uid,
              name: member.name,
              email: member.email,
              pendingEmail: member.pendingEmail,
              locale: memberLocale,
              resolvedLocale: resolveAppLocale({
                memberLocale,
                familyLocale,
              }),
              role: member.role,
              status: member.status,
              lastSignInAt: member.lastSignInAt,
              dashboardPrimaryColor: resolveMemberPrimaryColor(member.dashboardPrimaryColor),
              avatarId: member.avatarId,
              avatarPhotoUrl: member.avatarPhotoUrl,
              stats:
                memberStatsByKey.get(resolveMemberStatsKey(member)) ??
                createEmptyMemberStats(),
            };
          })
          .slice(0, MAX_FAMILY_MEMBERS);

        return {
          viewerUid: session.uid,
          viewerAssigneeAliases,
          viewerGoogleTasksLinked,
          resolvedLocale: resolveAppLocale({
            sessionLocale: session.locale,
            memberLocale: viewerMember?.locale,
            familyLocale,
          }),
          wsAuthToken: createFamilySocketAuthToken({
            uid: session.uid,
            familyIds: [familyId],
          }),
          noFamily: false,
          family: {
            id: familyId,
            name: familyName,
            defaultLocale: familyLocale,
          },
          members: mappedMembers,
          categories,
          choresToday: choreDocs
            .map((doc) => ({
              id: documentIdFromName(doc.name),
              title: readString(doc.fields, "title") || "Untitled chore",
              choreType: normalizeChoreType(
                readString(doc.fields, "choreType"),
                readString(doc.fields, "assigneeScope") === "family" ||
                  readStringArray(doc.fields, "assigneeIds").length > 1
                  ? "group"
                  : "normal",
              ),
              status: readString(doc.fields, "status"),
              assigneeId: readString(doc.fields, "assigneeId") || undefined,
              assigneeIds: readStringArray(doc.fields, "assigneeIds"),
              assigneeScope: parseAssigneeScope(readString(doc.fields, "assigneeScope")),
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
              actionHref: readString(doc.fields, "actionHref") || undefined,
              actionLabel: readString(doc.fields, "actionLabel") || undefined,
              categoryIds: readChoreCategoryIds(doc.fields),
              deleted: readBoolean(doc.fields, "deleted"),
              coinValue: normalizeCoinValue(readInteger(doc.fields, "coinValue")),
              requireApproval: readBoolean(doc.fields, "requireApproval"),
              newSkillEnabled:
                !doc.fields || !Object.prototype.hasOwnProperty.call(doc.fields, "newSkillEnabled")
                  ? true
                  : readBoolean(doc.fields, "newSkillEnabled"),
              recurrence: normalizeRecurrenceConfig({
                recurrenceType: readString(doc.fields, "recurrenceType"),
                recurrenceInterval: readInteger(doc.fields, "recurrenceInterval"),
                recurrenceUnit: readString(doc.fields, "recurrenceUnit"),
                recurrenceDays: readStringArray(doc.fields, "recurrenceDays"),
              }),
              source:
                readString(doc.fields, "source") === "google_tasks"
                  ? ("google_tasks" as const)
                  : ("manual" as const),
              sortOrder: readOptionalSortOrder(doc.fields),
              createdAt: readTimestamp(doc.fields, "createdAt") || undefined,
              responsibilityPillar:
                normalizeResponsibilityPillar(readString(doc.fields, "responsibilityPillar")) ||
                undefined,
              responsibilityXpReward: readInteger(doc.fields, "responsibilityXpReward"),
              routineAssignmentId: readString(doc.fields, "routineAssignmentId") || undefined,
              routineId: readString(doc.fields, "routineId") || undefined,
              routineName: readString(doc.fields, "routineName") || undefined,
              routineStepOrder: readInteger(doc.fields, "routineStepOrder") || undefined,
              routineStepCount: readInteger(doc.fields, "routineStepCount") || undefined,
              newSkillBonusEligible: resolveNewSkillBonusEligible(
                doc.fields,
                documentIdFromName(doc.name),
                normalizeChoreType(
                  readString(doc.fields, "choreType"),
                  readString(doc.fields, "assigneeScope") === "family" ||
                    readStringArray(doc.fields, "assigneeIds").length > 1
                    ? "group"
                    : "normal",
                ),
                parseAssigneeScope(readString(doc.fields, "assigneeScope")),
                readString(doc.fields, "assigneeId"),
              ),
            }))
            .filter(
              (chore) =>
                !chore.deleted &&
                chore.status === "Open" &&
                !isAfterLocalToday(chore.dueDate, timezoneOffsetMinutes),
            )
            .sort(compareBySortOrderOrOldest)
            .map((chore) => {
              const progressPlayerId = resolveSingleAssigneeUid(chore, memberUidByAlias);
              const responsibilityProgress = buildResponsibilityProgressProjection({
                playerId: progressPlayerId,
                pillar: chore.responsibilityPillar,
                progressFields:
                  responsibilityProgressFieldsByPlayer.get(progressPlayerId),
                choreXpAwarded:
                  chore.responsibilityXpReward >= 0
                    ? chore.responsibilityXpReward
                    : responsibilityConfig.xpValues.choreCompletionXp,
                newSkillXpAwarded: chore.newSkillBonusEligible
                  ? responsibilityConfig.xpValues.newSkillBonusXp
                  : 0,
                levelThresholds: responsibilityConfig.levelThresholds,
              });
              return {
                id: chore.id,
                title: chore.title,
                choreType: chore.choreType,
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
                actionHref: chore.actionHref,
                actionLabel: chore.actionLabel,
                categoryIds: chore.categoryIds,
                categories: resolveChoreCategories(chore.categoryIds, categoryMap),
                coinValue: chore.coinValue,
                requireApproval: chore.requireApproval,
                newSkillEnabled: chore.newSkillEnabled,
                recurrenceType: chore.recurrence.recurrenceType,
                recurrenceInterval: chore.recurrence.recurrenceInterval,
                recurrenceUnit: chore.recurrence.recurrenceUnit,
                recurrenceDays: chore.recurrence.recurrenceDays,
                newSkillBonusEligible: chore.newSkillBonusEligible,
                newSkillBonusAmount: chore.newSkillBonusEligible
                  ? NEW_SKILL_BONUS_AMOUNT
                  : undefined,
                responsibilityPillar: chore.responsibilityPillar,
                responsibilityProgress,
                routineAssignmentId: chore.routineAssignmentId,
                routineId: chore.routineId,
                routineName: chore.routineName,
                routineStepOrder: chore.routineStepOrder,
                routineStepCount: chore.routineStepCount,
                source: chore.source,
                status:
                  chore.status === "Open" ||
                  chore.status === "Submitted" ||
                  chore.status === "Approved" ||
                  chore.status === "Rejected"
                    ? chore.status
                    : "Unknown",
              };
            }),
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
    const resolvedViewerLocale = data.resolvedLocale || DEFAULT_LOCALE;
    if (
      resolvedViewerRole !== refreshedSession.role ||
      resolvedViewerMemberId !== refreshedSession.memberId ||
      resolvedViewerLocale !== refreshedSession.locale
    ) {
      nextSession = {
        ...refreshedSession,
        role: resolvedViewerRole,
        memberId: resolvedViewerMemberId,
        locale: resolvedViewerLocale,
      };
      shouldSetSessionCookie = true;
    }

    const response = NextResponse.json(data);
    response.headers.set("Server-Timing", formatServerTiming(timing));
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
















