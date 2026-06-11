import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  documentIdFromName,
  boolField,
  createOrReplaceDocument,
  type FirestoreValue,
  getDocument,
  integerField,
  listAllDocuments,
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
import { buildKioskActivityMetadata } from "@/lib/auth/kiosk";
import { applyWalletDelta } from "@/lib/economy/wallet";
import { publishFamilyActivity } from "@/lib/ws/publish-family-activity";
import { resolveMemberPrimaryColor } from "@/lib/theme/member-primary-color";
import { GOOGLE_TASKS_CHORE_SOURCE, syncGoogleTasksForUser } from "@/lib/google/tasks-sync";
import {
  DEFAULT_CHORE_COIN_VALUE,
  nextRecurringDueDate,
  normalizeCoinValue,
  normalizeRecurrenceConfig,
  parseCoinValue,
  parseRequireApproval,
  recurrenceLabel,
} from "@/lib/chores/recurrence";
import { normalizeChoreType } from "@/lib/chores/types";
import {
  buildCategoryMap,
  hasAllCategoryIds,
  listFamilyCategories,
  normalizeCategoryIds,
  readChoreCategoryIds,
  resolveChoreCategories,
} from "@/lib/family/categories";
import { computeCompletionDerivedMaximums, trackAchievementEvent } from "@/lib/achievements/service";
import { writeAuditLogBestEffort } from "@/lib/audit/log";
import {
  canonicalRecurringChoreId,
  claimNewSkillBonus,
  NEW_SKILL_BONUS_AMOUNT,
} from "@/lib/chores/skill-bonus";

type UpdateChoreBody = {
  action?: unknown;
  description?: unknown;
  assigneeId?: unknown;
  assigneeIds?: unknown;
  assigneeScope?: unknown;
  dueDate?: unknown;
  details?: unknown;
  categoryIds?: unknown;
  coinValue?: unknown;
  requireApproval?: unknown;
  recurrenceType?: unknown;
  recurrenceInterval?: unknown;
  recurrenceUnit?: unknown;
  feedback?: unknown;
  approvalPayouts?: unknown;
};
const MAX_ACTIVE_CHORES_PER_ASSIGNEE = 100;
// Safety cap when paging the full chores collection (recurring chores grow it
// without bound). Mirrors MAX_CHORE_ARCHIVE in the chores list route.
const MAX_CHORE_SCAN = 5000;

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

async function syncGoogleTasksBestEffort(input: {
  uid: string;
  idToken: string;
  force?: boolean;
  minIntervalSeconds?: number;
}) {
  try {
    await syncGoogleTasksForUser(input);
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[GOOGLE_TASKS_SYNC_AFTER_CHORE_ERROR]", reason);
  }
}

async function trackAchievementEventBestEffort(input: Parameters<typeof trackAchievementEvent>[0]) {
  try {
    await trackAchievementEvent(input);
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[ACHIEVEMENT_TRACK_AFTER_CHORE_ERROR]", reason);
  }
}

async function computeCompletionDerivedMaximumsBestEffort(
  input: Parameters<typeof computeCompletionDerivedMaximums>[0],
) {
  try {
    return await computeCompletionDerivedMaximums(input);
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[ACHIEVEMENT_DERIVED_AFTER_CHORE_ERROR]", reason);
    return undefined;
  }
}

async function emitFamilyActivityBestEffort(input: Parameters<typeof emitFamilyActivity>[0]) {
  try {
    await emitFamilyActivity(input);
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[FAMILY_ACTIVITY_AFTER_CHORE_ERROR]", reason);
  }
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

function normalizeAssigneeIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

type ApprovalPayoutEntry = {
  assigneeId: string;
  coinValue: number;
};

function parseApprovalPayoutsJson(value: string): ApprovalPayoutEntry[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    const normalized: ApprovalPayoutEntry[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const assigneeId =
        "assigneeId" in entry && typeof entry.assigneeId === "string"
          ? entry.assigneeId.trim()
          : "";
      const coinValue =
        "coinValue" in entry && typeof entry.coinValue === "number" && Number.isFinite(entry.coinValue)
          ? Math.max(0, Math.trunc(entry.coinValue))
          : -1;
      if (assigneeId && coinValue >= 0) {
        normalized.push({ assigneeId, coinValue });
      }
    }
    return normalized;
  } catch {
    return [];
  }
}

function asValidDate(value: unknown) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  return "";
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

async function removeSpawnedRecurringChoreIfPossible(
  familyId: string,
  spawnedNextChoreId: string,
  idToken: string,
  now: string,
) {
  if (!spawnedNextChoreId) {
    return { kind: "ok" as const };
  }
  const spawnedDoc = await getDocument(
    `families/${familyId}/chores/${spawnedNextChoreId}`,
    idToken,
  );
  if (readBoolean(spawnedDoc.fields, "deleted")) {
    return { kind: "ok" as const };
  }
  const status = readString(spawnedDoc.fields, "status") || "Open";
  if (status !== "Open") {
    return { kind: "recurring_successor_locked" as const };
  }
  await patchDocument(
    `families/${familyId}/chores/${spawnedNextChoreId}`,
    {
      deleted: boolField(true),
      deletedAt: timestampField(now),
      status: stringField("Deleted"),
      updatedAt: timestampField(now),
    },
    idToken,
    ["deleted", "deletedAt", "status", "updatedAt"],
  );
  return { kind: "ok" as const };
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
  const normalizedAssignee = normalizeEmail(assigneeId);
  let matchedEmail = "";
  try {
    const memberDoc = await getDocument(`families/${familyId}/members/${assigneeId}`, idToken);
    if (readBoolean(memberDoc.fields, "deleted")) {
      return "";
    }
    const memberUid = readString(memberDoc.fields, "uid");
    if (memberUid) {
      return memberUid;
    }
    matchedEmail = normalizeEmail(readString(memberDoc.fields, "email"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_HTTP_404")) {
      throw error;
    }
  }

  const memberDocs = await listDocuments(`families/${familyId}/members`, idToken, 100);
  for (const memberDoc of memberDocs) {
    if (readBoolean(memberDoc.fields, "deleted")) {
      continue;
    }
    const memberId = documentIdFromName(memberDoc.name);
    const memberUid = readString(memberDoc.fields, "uid");
    const memberEmail = normalizeEmail(readString(memberDoc.fields, "email"));
    const aliasMatch =
      memberId === assigneeId ||
      (memberUid && memberUid === assigneeId) ||
      (normalizedAssignee !== "" && memberEmail === normalizedAssignee);
    if (aliasMatch) {
      if (memberUid) {
        return memberUid;
      }
      if (!matchedEmail && memberEmail) {
        matchedEmail = memberEmail;
      }
    }
  }

  if (matchedEmail) {
    for (const memberDoc of memberDocs) {
      if (readBoolean(memberDoc.fields, "deleted")) {
        continue;
      }
      const memberUid = readString(memberDoc.fields, "uid");
      const memberEmail = normalizeEmail(readString(memberDoc.fields, "email"));
      if (memberUid && memberEmail === matchedEmail) {
        return memberUid;
      }
    }
  }

  return "";
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
  const docs = await listAllDocuments(`families/${familyId}/chores`, idToken, {
    cap: MAX_CHORE_SCAN,
  });
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

async function listActiveFamilyMemberIds(familyId: string, idToken: string) {
  const memberDocs = await listDocuments(`families/${familyId}/members`, idToken, 200);
  return memberDocs
    .filter((doc) => !readBoolean(doc.fields, "deleted"))
    .filter((doc) => {
      const status = readString(doc.fields, "status");
      return status === "" || status === "active";
    })
    .map((doc) => documentIdFromName(doc.name))
    .filter(Boolean);
}

async function userHasFamilyMembership(uid: string, familyId: string, idToken: string) {
  try {
    const userDoc = await getDocument(`users/${uid}`, idToken);
    const familyIds = readStringArray(userDoc.fields, "familyIds");
    return familyIds.includes(familyId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_HTTP_404")) {
      return false;
    }
    throw error;
  }
}

async function resolveChoreAssigneeIds(
  familyId: string,
  fields: Record<string, FirestoreValue> | undefined,
  idToken: string,
) {
  const assigneeId = readString(fields, "assigneeId");
  const assigneeIdsRaw = readStringArray(fields, "assigneeIds");
  const assigneeScope = readString(fields, "assigneeScope");
  if (assigneeScope === "family") {
    return listActiveFamilyMemberIds(familyId, idToken);
  }
  if (assigneeIdsRaw.length > 0) {
    return assigneeIdsRaw;
  }
  return assigneeId ? [assigneeId] : [];
}

function buildPayoutByAssignee(params: {
  assigneeIds: string[];
  totalCoinValue: number;
  storedPayoutsJson?: string;
  overrides?: unknown;
}) {
  const { assigneeIds, totalCoinValue, storedPayoutsJson = "", overrides } = params;
  const payoutByAssignee = new Map<string, number>();
  const storedPayouts = parseApprovalPayoutsJson(storedPayoutsJson);
  if (storedPayouts.length > 0) {
    for (const payout of storedPayouts) {
      payoutByAssignee.set(payout.assigneeId, payout.coinValue);
    }
    return payoutByAssignee;
  }

  const defaultSplit =
    assigneeIds.length > 0 ? Math.ceil(totalCoinValue / assigneeIds.length) : totalCoinValue;
  const overrideByAssignee = new Map<string, number>();
  if (Array.isArray(overrides)) {
    for (const entry of overrides) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const maybeId =
        "assigneeId" in entry && typeof entry.assigneeId === "string"
          ? entry.assigneeId.trim()
          : "";
      const maybeCoin =
        "coinValue" in entry &&
        typeof entry.coinValue === "number" &&
        Number.isFinite(entry.coinValue)
          ? Math.max(0, Math.trunc(entry.coinValue))
          : -1;
      if (maybeId && maybeCoin >= 0) {
        overrideByAssignee.set(maybeId, maybeCoin);
      }
    }
  }
  for (const assigneeId of assigneeIds) {
    payoutByAssignee.set(assigneeId, overrideByAssignee.get(assigneeId) ?? defaultSplit);
  }
  return payoutByAssignee;
}

async function applyPayoutByAssignee(params: {
  familyId: string;
  idToken: string;
  choreId: string;
  payoutByAssignee: Map<string, number>;
  direction: "credit" | "debit";
  actorUid?: string;
  actorRole?: "admin" | "player";
  choreStatus?: string;
}) {
  const { familyId, idToken, choreId, payoutByAssignee, direction, actorUid = "", actorRole = "player", choreStatus = "" } = params;
  console.log("[PAYOUT_BY_ASSIGNEE_ATTEMPT]", {
    familyId,
    choreId,
    direction,
    actorUid,
    actorRole,
    choreStatus,
    payoutEntries: Array.from(payoutByAssignee.entries()),
  });
  let anyApplied = false;
  for (const [assigneeAlias, coins] of payoutByAssignee.entries()) {
    if (coins <= 0) {
      continue;
    }
    const assigneeUid = await resolveAssigneeUid(familyId, assigneeAlias, idToken);
    console.log("[PAYOUT_BY_ASSIGNEE_RESOLVE]", {
      familyId,
      choreId,
      direction,
      assigneeAlias,
      assigneeUid: assigneeUid || "",
      coins,
    });
    if (!assigneeUid) {
      continue;
    }
    try {
      await applyWalletDelta({
        uid: assigneeUid,
        idToken,
        delta: direction === "credit" ? coins : -coins,
        reason: direction === "credit" ? "chore_complete" : "chore_undo_complete",
        choreId,
        debugMeta: {
          familyId,
          actorUid,
          actorRole,
          choreStatus,
          assigneeAlias,
          assigneeUid,
          direction,
          coins,
        },
      });
      anyApplied = true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      console.error("[PAYOUT_BY_ASSIGNEE_ERROR]", {
        familyId,
        choreId,
        direction,
        actorUid,
        actorRole,
        choreStatus,
        assigneeAlias,
        assigneeUid,
        coins,
        reason: reason.slice(0, 220),
      });
      if (direction === "debit" && reason.includes("WALLET_NEGATIVE_BLOCKED")) {
        return { kind: "wallet_negative_blocked" as const };
      }
      if (reason.includes("FIRESTORE_HTTP_403")) {
        return { kind: "wallet_permission_denied" as const };
      }
      if (!reason.includes("FIRESTORE_HTTP_404")) {
        throw error;
      }
    }
  }
  return { kind: "ok" as const, anyApplied };
}

type NewSkillBonusOutcome = {
  awarded: boolean;
  amount: number;
  totalCoins: number;
  playerUids: string[];
};

const EMPTY_NEW_SKILL_BONUS: NewSkillBonusOutcome = {
  awarded: false,
  amount: NEW_SKILL_BONUS_AMOUNT,
  totalCoins: 0,
  playerUids: [],
};

// Awards the one-time New Skill Bonus to every assignee who is being paid for
// the first completion of this chore identity. Runs at the same lifecycle point
// as normal chore coins (immediate completion or approval). The durable claim
// record makes it idempotent: retries, websocket replays and double-approvals
// resolve to no additional payout. Best-effort — never throws into the
// completion flow.
async function awardNewSkillBonuses(params: {
  familyId: string;
  idToken: string;
  rootChoreId: string;
  payoutByAssignee: Map<string, number>;
  sourceCompletionId: string;
}): Promise<NewSkillBonusOutcome> {
  const { familyId, idToken, rootChoreId, payoutByAssignee, sourceCompletionId } = params;
  if (!rootChoreId) {
    return EMPTY_NEW_SKILL_BONUS;
  }
  let totalCoins = 0;
  const playerUids: string[] = [];
  const seenUids = new Set<string>();
  for (const [assigneeAlias, coins] of payoutByAssignee.entries()) {
    if (coins <= 0) {
      continue;
    }
    const assigneeUid = await resolveAssigneeUid(familyId, assigneeAlias, idToken);
    if (!assigneeUid || seenUids.has(assigneeUid)) {
      continue;
    }
    seenUids.add(assigneeUid);
    try {
      const { firstTime } = await claimNewSkillBonus({
        familyId,
        playerUid: assigneeUid,
        rootChoreId,
        sourceCompletionId,
        idToken,
      });
      if (!firstTime) {
        continue;
      }
      await applyWalletDelta({
        uid: assigneeUid,
        idToken,
        delta: NEW_SKILL_BONUS_AMOUNT,
        reason: "new_skill_bonus",
        choreId: rootChoreId,
        debugMeta: { familyId, rootChoreId, sourceCompletionId, assigneeAlias },
      });
      totalCoins += NEW_SKILL_BONUS_AMOUNT;
      playerUids.push(assigneeUid);
    } catch (error) {
      const reason = error instanceof Error && error.message ? error.message.slice(0, 200) : "unknown";
      console.error("[NEW_SKILL_BONUS_AWARD_ERROR]", {
        familyId,
        rootChoreId,
        assigneeUid,
        reason,
      });
    }
  }
  return {
    awarded: playerUids.length > 0,
    amount: NEW_SKILL_BONUS_AMOUNT,
    totalCoins,
    playerUids,
  };
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
            choreType: normalizeChoreType(
              readString(choreDoc.fields, "choreType"),
              readString(choreDoc.fields, "assigneeScope") === "family" ||
                readStringArray(choreDoc.fields, "assigneeIds").length > 1
                ? "group"
                : "normal",
            ),
            status: readString(choreDoc.fields, "status") || "Open",
            source:
              readString(choreDoc.fields, "source") === GOOGLE_TASKS_CHORE_SOURCE
                ? "google_tasks"
                : "manual",
            sortOrder: readOptionalSortOrder(choreDoc.fields),
            assigneeId: readString(choreDoc.fields, "assigneeId") || undefined,
            assigneeIds: readStringArray(choreDoc.fields, "assigneeIds"),
            assigneeScope:
              readString(choreDoc.fields, "assigneeScope") === "family"
                ? "family"
                : readString(choreDoc.fields, "assigneeScope") === "multiple"
                  ? "multiple"
                  : "single",
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
            actionHref: readString(choreDoc.fields, "actionHref") || undefined,
            actionLabel: readString(choreDoc.fields, "actionLabel") || undefined,
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
            coinValue: normalizeCoinValue(readInteger(choreDoc.fields, "coinValue")),
            requireApproval: readBoolean(choreDoc.fields, "requireApproval"),
            recurrenceType: normalizeRecurrenceConfig({
              recurrenceType: readString(choreDoc.fields, "recurrenceType"),
              recurrenceInterval: readInteger(choreDoc.fields, "recurrenceInterval"),
              recurrenceUnit: readString(choreDoc.fields, "recurrenceUnit"),
            }).recurrenceType,
            recurrenceInterval: readInteger(choreDoc.fields, "recurrenceInterval") || undefined,
            recurrenceUnit: readString(choreDoc.fields, "recurrenceUnit") || undefined,
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

function isRequesterAssignee(choreAssigneeId: string, uid: string, memberId: string, email: string) {
  if (!choreAssigneeId) {
    return false;
  }
  if (choreAssigneeId === uid || choreAssigneeId === memberId) {
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
  let emailMatchedRole: "admin" | "player" | null = null;
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
      } else if (emailMatch && !emailMatchedRole) {
        emailMatchedRole = toRole(readString(doc.fields, "role"));
      }
    }
  }

  if (!roleResolved && emailMatchedRole) {
    role = emailMatchedRole;
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
  if (
    action !== "edit" &&
    action !== "complete" &&
    action !== "undo_complete" &&
    action !== "set_categories" &&
    action !== "approve" &&
    action !== "reject"
  ) {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  const normalizedDescription =
    typeof body.description === "string" ? normalizeDescription(body.description) : "";
  const assigneeId =
    typeof body.assigneeId === "string" && body.assigneeId.trim().length > 0
      ? body.assigneeId.trim()
      : "";
  const assigneeIds = normalizeAssigneeIds(body.assigneeIds);
  const assigneeScope =
    body.assigneeScope === "family" || body.assigneeScope === "multiple" || body.assigneeScope === "single"
      ? body.assigneeScope
      : "";
  const dueDate = asValidDate(body.dueDate);
  const details =
    typeof body.details === "string" && body.details.trim().length > 0
      ? body.details.trim().slice(0, 2000)
      : "";
  const coinValue = parseCoinValue(body.coinValue);
  const requireApproval = parseRequireApproval(body.requireApproval);
  const recurrence = normalizeRecurrenceConfig({
    recurrenceType: body.recurrenceType,
    recurrenceInterval: body.recurrenceInterval,
    recurrenceUnit: body.recurrenceUnit,
  });
  const feedback =
    typeof body.feedback === "string" && body.feedback.trim().length > 0
      ? body.feedback.trim().slice(0, 500)
      : "";
  const hasCategoryIds = Array.isArray(body.categoryIds);
  const categoryIds = normalizeCategoryIds(body.categoryIds);
  const resolvedAssigneeIds = assigneeIds.length > 0 ? assigneeIds : assigneeId ? [assigneeId] : [];
  const resolvedAssigneeScope =
    assigneeScope || (resolvedAssigneeIds.length > 1 ? "multiple" : resolvedAssigneeIds.length === 1 ? "single" : "single");
  const resolvedSingleAssigneeId =
    resolvedAssigneeScope === "single" && resolvedAssigneeIds.length === 1 ? resolvedAssigneeIds[0] : "";

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
    if (coinValue === null) {
      return NextResponse.json({ error: "invalid_coin_value" }, { status: 400 });
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
        let newSkillBonus: NewSkillBonusOutcome = EMPTY_NEW_SKILL_BONUS;
        if (action === "complete") {
          const existingChoreDoc = await getDocument(`families/${familyId}/chores/${choreId}`, idToken);
          const choreTitle = readString(existingChoreDoc.fields, "title") || "Untitled chore";
          const choreAssigneeId = readString(existingChoreDoc.fields, "assigneeId");
          const choreAssigneeIdsRaw = readStringArray(existingChoreDoc.fields, "assigneeIds");
          const choreAssigneeScope = readString(existingChoreDoc.fields, "assigneeScope");
          const choreType = normalizeChoreType(
            readString(existingChoreDoc.fields, "choreType"),
            choreAssigneeScope === "family" || choreAssigneeIdsRaw.length > 1 ? "group" : "normal",
          );
          const choreAssigneeIds = await resolveChoreAssigneeIds(
            familyId,
            existingChoreDoc.fields,
            idToken,
          );
          const choreSource = readString(existingChoreDoc.fields, "source");
          const choreGoogleTaskOwnerUid = readString(existingChoreDoc.fields, "googleTaskOwnerUid");
          const choreCoinValue = normalizeCoinValue(readInteger(existingChoreDoc.fields, "coinValue"));
          const choreDetails = readString(existingChoreDoc.fields, "details") || "";
          const choreCategoryIds = readChoreCategoryIds(existingChoreDoc.fields);
          const choreRequireApproval = readBoolean(existingChoreDoc.fields, "requireApproval");
          const choreRecurrence = normalizeRecurrenceConfig({
            recurrenceType: readString(existingChoreDoc.fields, "recurrenceType"),
            recurrenceInterval: readInteger(existingChoreDoc.fields, "recurrenceInterval"),
            recurrenceUnit: readString(existingChoreDoc.fields, "recurrenceUnit"),
          });
          const currentStatus = readString(existingChoreDoc.fields, "status") || "Open";
          const hadPriorSubmission = Boolean(readTimestamp(existingChoreDoc.fields, "submittedAt"));
          // Canonical identity used for the New Skill Bonus: the root chore of a
          // recurring series so the bonus is granted only on the child's first
          // completion of the recurring task, never on later occurrences.
          const rootChoreId = canonicalRecurringChoreId(existingChoreDoc.fields, choreId);
          if (choreSource === GOOGLE_TASKS_CHORE_SOURCE && choreGoogleTaskOwnerUid) {
            syncOwnerUid = choreGoogleTaskOwnerUid;
          } else if (isRequesterAssignee(choreAssigneeId, session.uid, session.memberId, session.email)) {
            syncOwnerUid = session.uid;
          }
          if (currentStatus !== "Open") {
            return { kind: "invalid_transition" as const };
          }
          const requesterOwnsChore = choreAssigneeIds.some((id) =>
            isRequesterAssignee(id, session.uid, session.memberId, session.email),
          );
          const requester = await getRequesterContext(
            familyId,
            session.uid,
            session.email,
            idToken,
          );
          if (!requesterOwnsChore && requester.role !== "admin") {
            return { kind: "forbidden_action" as const };
          }
          let spawnedNextChoreId = "";
          const approvalRequiredByChore =
            choreRequireApproval || choreAssigneeIds.length > 1 || choreType === "see_and_do";
          const completionNeedsApproval = requester.role !== "admin" && approvalRequiredByChore;
          const nextStatus = completionNeedsApproval ? "Submitted" : "Approved";
          const payoutByAssignee =
            nextStatus === "Approved"
              ? buildPayoutByAssignee({
                  assigneeIds: choreAssigneeIds,
                  totalCoinValue: choreCoinValue,
                  overrides: body.approvalPayouts,
                })
              : new Map<string, number>();
          const approvedCoinValue =
            nextStatus === "Approved"
              ? Array.from(payoutByAssignee.values()).reduce(
                  (total, coins) => total + Math.max(0, Math.trunc(coins || 0)),
                  0,
                )
              : choreCoinValue;
          const completionDate = now.slice(0, 10);
          if (choreRecurrence.recurrenceType !== "none") {
            const nextDueDate = nextRecurringDueDate(
              completionDate,
              choreRecurrence,
              completionDate,
            );
            const allChoreDocs = await listAllDocuments(`families/${familyId}/chores`, idToken, {
              cap: MAX_CHORE_SCAN,
            });
            const openChores = allChoreDocs.filter((doc) => {
              if (readBoolean(doc.fields, "deleted")) {
                return false;
              }
              return readString(doc.fields, "status") === "Open";
            });
            const nextSortOrder =
              openChores.reduce((maxValue, doc) => {
                const value = doc.fields?.sortOrder;
                const raw =
                  value && "integerValue" in value
                    ? Number(value.integerValue)
                    : value && "stringValue" in value
                      ? Number(value.stringValue)
                      : Number.NaN;
                return Number.isFinite(raw) ? Math.max(maxValue, Math.trunc(raw)) : maxValue;
              }, -1) + 1;
            spawnedNextChoreId = randomUUID();
            await createOrReplaceDocument(
              `families/${familyId}/chores/${spawnedNextChoreId}`,
              {
                title: stringField(choreTitle),
                choreType: stringField(choreType),
                status: stringField("Open"),
                assigneeId: stringField(choreAssigneeId),
                assigneeIds: stringArrayField(choreAssigneeIdsRaw),
                assigneeScope: stringField(choreAssigneeScope || "single"),
                assigneeName: stringField(readString(existingChoreDoc.fields, "assigneeName") || "Unassigned"),
                details: stringField(choreDetails),
                categoryIds: stringArrayField(choreCategoryIds),
                dueDate: stringField(nextDueDate),
                coinValue: integerField(choreCoinValue),
                requireApproval: boolField(choreRequireApproval),
                recurrenceType: stringField(choreRecurrence.recurrenceType),
                recurrenceInterval: integerField(choreRecurrence.recurrenceInterval ?? 0),
                recurrenceUnit: stringField(choreRecurrence.recurrenceUnit ?? ""),
                recurrenceParentChoreId: stringField(choreId),
                recurrenceRootChoreId: stringField(rootChoreId),
                deleted: boolField(false),
                createdBy: stringField(session.uid),
                createdAt: timestampField(now),
                sortOrder: integerField(nextSortOrder),
                source: stringField("manual"),
              },
              idToken,
            );
          }
          const completionPatchFields: Record<string, FirestoreValue> = {
            status: stringField(nextStatus),
            submittedAt: timestampField(now),
            updatedAt: timestampField(now),
            spawnedNextChoreId: stringField(spawnedNextChoreId),
          };
          const completionUpdateMask = ["status", "submittedAt", "updatedAt", "spawnedNextChoreId"];
          if (nextStatus === "Approved") {
            completionPatchFields.approvalPayoutsJson = stringField(
              JSON.stringify(
                Array.from(payoutByAssignee.entries()).map(([assigneeId, coinValue]) => ({
                  assigneeId,
                  coinValue,
                })),
              ),
            );
            completionPatchFields.coinValue = integerField(approvedCoinValue);
            completionUpdateMask.push("approvalPayoutsJson", "coinValue");
          }
          await patchDocument(
            `families/${familyId}/chores/${choreId}`,
            completionPatchFields,
            idToken,
            completionUpdateMask,
          );
          await writeAuditLogBestEffort({
            familyId,
            idToken,
            eventType: "chore_status_changed",
            actor: {
              uid: session.uid,
              email: session.email,
              name: actorName,
              role: requester.role,
            },
            userId: choreAssigneeId,
            choreId,
            choreTitle,
            source: choreSource || "manual",
            previous: { status: currentStatus },
            next: {
              status: nextStatus,
              coinValue: approvedCoinValue,
              submittedAt: now,
              spawnedNextChoreId,
              requireApproval: completionNeedsApproval,
            },
            reason: "complete",
          });
          let payoutApplied = false;
          if (nextStatus === "Approved") {
            const payoutResult = await applyPayoutByAssignee({
              familyId,
              idToken,
              choreId,
              payoutByAssignee,
              direction: "credit",
              actorUid: session.uid,
              actorRole: requester.role,
              choreStatus: currentStatus,
            });
            if (payoutResult.kind === "wallet_permission_denied") {
              return { kind: "wallet_permission_denied" as const };
            }
            payoutApplied = payoutResult.kind === "ok" && payoutResult.anyApplied;
            newSkillBonus = await awardNewSkillBonuses({
              familyId,
              idToken,
              rootChoreId,
              payoutByAssignee,
              sourceCompletionId: choreId,
            });
          }
          const assigneeUid = await resolveAssigneeUid(familyId, choreAssigneeId, idToken);
          // Kiosk Mode attribution: in kiosk the current identity is the player,
          // so the player is recorded as the actor (parents are still notified)
          // while the originally signed-in account is preserved as
          // authenticated_user_id and the event is tagged source=kiosk.
          const kioskActivity = buildKioskActivityMetadata(session, choreAssigneeId || assigneeUid);
          await emitFamilyActivityBestEffort({
            familyId,
            idToken,
            kind: "chore_completed",
            actorUid: session.uid,
            actorEmail: session.email,
            actorName,
            title: completionNeedsApproval ? "Chore submitted for approval" : "Chore completed",
            message: completionNeedsApproval
              ? `${actorName} completed "${choreTitle}" and it is waiting for parent approval.`
              : `${actorName} marked "${choreTitle}" complete${payoutApplied ? ` and earned ${approvedCoinValue} coins` : ""}.${newSkillBonus.awarded ? ` 🎉 New Skill Learned (+${newSkillBonus.totalCoins} bonus coins)!` : ""}${choreRecurrence.recurrenceType !== "none" ? ` ${recurrenceLabel(choreRecurrence)}.` : ""}`,
            choreId,
            choreTitle,
            relatedIds: choreAssigneeId ? [choreAssigneeId] : [],
            pushType: completionNeedsApproval ? "chore_approval_required" : "chore_completed",
            source: kioskActivity.source,
            authenticatedUid: kioskActivity.authenticatedUid,
            completedForPlayerId: kioskActivity.completedForPlayerId,
            newSkillBonusAwarded: newSkillBonus.awarded,
            newSkillBonusAmount: newSkillBonus.totalCoins,
          });
          await publishFamilyActivity({
            type: "chore_completed",
            familyId,
            choreId,
            occurredAt: now,
            source: kioskActivity.source,
            authenticatedUid: kioskActivity.authenticatedUid,
            completedForPlayerId: kioskActivity.completedForPlayerId,
            newSkillBonusAwarded: newSkillBonus.awarded,
            newSkillBonusAmount: newSkillBonus.totalCoins,
          });
          if (assigneeUid) {
            const completionHour = new Date(now).getUTCHours();
            const derivedMaximums = await computeCompletionDerivedMaximumsBestEffort({
              familyId,
              uid: assigneeUid,
              idToken,
              completedAtIso: now,
            });
            await trackAchievementEventBestEffort({
              uid: assigneeUid,
              familyId,
              idToken,
              viewerRole: "player",
              eventId: `chore_complete_${choreId}_${nextStatus}`,
              metricDeltas: {
                chores_completed: 1,
                coins_earned: payoutApplied ? (payoutByAssignee.get(choreAssigneeId) ?? approvedCoinValue) : 0,
                morning_chores_completed: completionHour < 12 ? 1 : 0,
                evening_chores_completed: completionHour >= 18 ? 1 : 0,
                google_task_chores_completed: choreSource === GOOGLE_TASKS_CHORE_SOURCE ? 1 : 0,
                reopened_chores_completed: hadPriorSubmission ? 1 : 0,
              },
              metricMaximums: derivedMaximums,
              consumeRejectionFlagOnComplete: true,
            });
          }
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
          const choreAssigneeIdsRaw = readStringArray(existingChoreDoc.fields, "assigneeIds");
          const choreAssigneeScope = readString(existingChoreDoc.fields, "assigneeScope");
          const choreAssigneeIds =
            choreAssigneeScope === "family"
              ? await listActiveFamilyMemberIds(familyId, idToken)
              : choreAssigneeIdsRaw.length > 0
                ? choreAssigneeIdsRaw
                : choreAssigneeId
                  ? [choreAssigneeId]
                  : [];
          const choreSource = readString(existingChoreDoc.fields, "source");
          const choreGoogleTaskOwnerUid = readString(existingChoreDoc.fields, "googleTaskOwnerUid");
          const choreCoinValue = normalizeCoinValue(readInteger(existingChoreDoc.fields, "coinValue"));
          const spawnedNextChoreId = readString(existingChoreDoc.fields, "spawnedNextChoreId");
          if (choreSource === GOOGLE_TASKS_CHORE_SOURCE && choreGoogleTaskOwnerUid) {
            syncOwnerUid = choreGoogleTaskOwnerUid;
          } else if (isRequesterAssignee(choreAssigneeId, session.uid, session.memberId, session.email)) {
            syncOwnerUid = session.uid;
          }
          if (
            currentStatus !== "Submitted" &&
            currentStatus !== "Approved" &&
            currentStatus !== "Rejected"
          ) {
            return { kind: "invalid_transition" as const };
          }
          const removeSpawnedResult = await removeSpawnedRecurringChoreIfPossible(
            familyId,
            spawnedNextChoreId,
            idToken,
            now,
          );
          if (removeSpawnedResult.kind === "recurring_successor_locked") {
            return { kind: "recurring_successor_locked" as const };
          }
          await patchDocument(
            `families/${familyId}/chores/${choreId}`,
            {
              status: stringField("Open"),
              updatedAt: timestampField(now),
              spawnedNextChoreId: stringField(""),
              rejectionFeedback: stringField(""),
              approvalPayoutsJson: stringField(""),
            },
            idToken,
            ["status", "updatedAt", "spawnedNextChoreId", "rejectionFeedback", "approvalPayoutsJson"],
          );
          await writeAuditLogBestEffort({
            familyId,
            idToken,
            eventType: "chore_status_changed",
            actor: {
              uid: session.uid,
              email: session.email,
              name: actorName,
              role: requester.role,
            },
            userId: choreAssigneeId,
            choreId,
            choreTitle,
            source: choreSource || "manual",
            previous: {
              status: currentStatus,
              spawnedNextChoreId,
              approvalPayoutsJson: readString(existingChoreDoc.fields, "approvalPayoutsJson"),
            },
            next: { status: "Open", spawnedNextChoreId: "" },
            reason: "undo_complete",
          });
          const payoutByAssignee = buildPayoutByAssignee({
            assigneeIds: choreAssigneeIds,
            totalCoinValue: choreCoinValue,
            storedPayoutsJson: readString(existingChoreDoc.fields, "approvalPayoutsJson"),
          });
          if (currentStatus === "Approved") {
            const payoutResult = await applyPayoutByAssignee({
              familyId,
              idToken,
              choreId,
              payoutByAssignee,
              direction: "debit",
              actorUid: session.uid,
              actorRole: requester.role,
              choreStatus: currentStatus,
            });
            if (payoutResult.kind === "wallet_negative_blocked") {
              return { kind: "wallet_negative_blocked" as const };
            }
            if (payoutResult.kind === "wallet_permission_denied") {
              return { kind: "wallet_permission_denied" as const };
            }
          }
          await emitFamilyActivityBestEffort({
            familyId,
            idToken,
            kind: "chore_undo_completed",
            actorUid: session.uid,
            actorEmail: session.email,
            actorName,
            title: "Completion undone",
            message: `${actorName} moved "${choreTitle}" back to open.${spawnedNextChoreId ? " The next recurring copy was removed." : ""}`,
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
        } else if (action === "approve") {
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
          const choreAssigneeIds = await resolveChoreAssigneeIds(
            familyId,
            existingChoreDoc.fields,
            idToken,
          );
          const choreCoinValue = normalizeCoinValue(readInteger(existingChoreDoc.fields, "coinValue"));
          const choreRequireApproval = readBoolean(existingChoreDoc.fields, "requireApproval");
          const rootChoreId = canonicalRecurringChoreId(existingChoreDoc.fields, choreId);
          if (currentStatus !== "Submitted" || !choreRequireApproval) {
            return { kind: "invalid_transition" as const };
          }
          const payoutByAssignee = buildPayoutByAssignee({
            assigneeIds: choreAssigneeIds,
            totalCoinValue: choreCoinValue,
            overrides: body.approvalPayouts,
          });
          const approvedCoinValue = Array.from(payoutByAssignee.values()).reduce(
            (total, coins) => total + Math.max(0, Math.trunc(coins || 0)),
            0,
          );
          await patchDocument(
            `families/${familyId}/chores/${choreId}`,
            {
              status: stringField("Approved"),
              approvalPayoutsJson: stringField(
                JSON.stringify(
                  Array.from(payoutByAssignee.entries()).map(([assigneeId, coinValue]) => ({
                    assigneeId,
                    coinValue,
                  })),
                ),
              ),
              coinValue: integerField(approvedCoinValue),
              updatedAt: timestampField(now),
            },
            idToken,
            ["status", "approvalPayoutsJson", "coinValue", "updatedAt"],
          );
          await writeAuditLogBestEffort({
            familyId,
            idToken,
            eventType: "chore_status_changed",
            actor: {
              uid: session.uid,
              email: session.email,
              name: actorName,
              role: requester.role,
            },
            userId: choreAssigneeId,
            choreId,
            choreTitle,
            source: readString(existingChoreDoc.fields, "source") || "manual",
            previous: { status: currentStatus, coinValue: choreCoinValue },
            next: { status: "Approved", coinValue: approvedCoinValue },
            reason: "approve",
          });
          const payoutResult = await applyPayoutByAssignee({
            familyId,
            idToken,
            choreId,
            payoutByAssignee,
            direction: "credit",
            actorUid: session.uid,
            actorRole: requester.role,
            choreStatus: currentStatus,
          });
          if (payoutResult.kind === "wallet_permission_denied") {
            return { kind: "wallet_permission_denied" as const };
          }
          const payoutApplied = payoutResult.kind === "ok" && payoutResult.anyApplied;
          newSkillBonus = await awardNewSkillBonuses({
            familyId,
            idToken,
            rootChoreId,
            payoutByAssignee,
            sourceCompletionId: choreId,
          });
          await emitFamilyActivityBestEffort({
            familyId,
            idToken,
            kind: "chore_approved",
            actorUid: session.uid,
            actorEmail: session.email,
            actorName,
            title: "Chore approved",
            message: `${actorName} approved "${choreTitle}"${payoutApplied ? " and paid coins" : ""}.${newSkillBonus.awarded ? ` 🎉 New Skill Learned (+${newSkillBonus.totalCoins} bonus coins)!` : ""}`,
            choreId,
            choreTitle,
            relatedIds: choreAssigneeId ? [choreAssigneeId] : [],
            newSkillBonusAwarded: newSkillBonus.awarded,
            newSkillBonusAmount: newSkillBonus.totalCoins,
          });
          await publishFamilyActivity({
            type: "chore_updated",
            familyId,
            choreId,
            occurredAt: now,
          });
          await trackAchievementEventBestEffort({
            uid: session.uid,
            familyId,
            idToken,
            viewerRole: "admin",
            eventId: `chore_approve_${choreId}`,
            metricDeltas: {
              admin_chores_approved: 1,
            },
          });
          try {
            for (const assigneeAlias of choreAssigneeIds) {
              const assigneeUid = await resolveAssigneeUid(familyId, assigneeAlias, idToken);
              if (!assigneeUid) {
                continue;
              }
              const canTrack = await userHasFamilyMembership(assigneeUid, familyId, idToken);
              if (!canTrack) {
                continue;
              }
              await trackAchievementEventBestEffort({
                uid: assigneeUid,
                familyId,
                idToken,
                viewerRole: "player",
                eventId: `chore_approved_${choreId}_${assigneeUid}`,
                metricDeltas: {
                  chores_approved: 1,
                  coins_earned: payoutByAssignee.get(assigneeAlias) ?? 0,
                },
                approvalStreakDelta: "increment",
              });
            }
          } catch (error) {
            const reason = error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
            console.error("[ACHIEVEMENT_TRACK_AFTER_CHORE_ERROR]", reason);
          }
        } else if (action === "reject") {
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
          const choreRequireApproval = readBoolean(existingChoreDoc.fields, "requireApproval");
          if (currentStatus !== "Submitted" || !choreRequireApproval) {
            return { kind: "invalid_transition" as const };
          }
          await patchDocument(
            `families/${familyId}/chores/${choreId}`,
            {
              status: stringField("Rejected"),
              rejectionFeedback: stringField(feedback),
              updatedAt: timestampField(now),
            },
            idToken,
            ["status", "rejectionFeedback", "updatedAt"],
          );
          await writeAuditLogBestEffort({
            familyId,
            idToken,
            eventType: "chore_status_changed",
            actor: {
              uid: session.uid,
              email: session.email,
              name: actorName,
              role: requester.role,
            },
            userId: choreAssigneeId,
            choreId,
            choreTitle,
            source: readString(existingChoreDoc.fields, "source") || "manual",
            previous: { status: currentStatus },
            next: { status: "Rejected", rejectionFeedback: feedback },
            reason: "reject",
          });
          await emitFamilyActivityBestEffort({
            familyId,
            idToken,
            kind: "chore_rejected",
            actorUid: session.uid,
            actorEmail: session.email,
            actorName,
            title: "Chore rejected",
            message: feedback
              ? `${actorName} rejected "${choreTitle}": ${feedback}`
              : `${actorName} rejected "${choreTitle}".`,
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
          try {
            const assigneeUid = await resolveAssigneeUid(familyId, choreAssigneeId, idToken);
            if (assigneeUid) {
              await trackAchievementEventBestEffort({
                uid: assigneeUid,
                familyId,
                idToken,
                viewerRole: "player",
                eventId: `chore_reject_${choreId}`,
                rejectionFlagSet: true,
                approvalStreakDelta: "reset",
              });
            }
          } catch (error) {
            const reason = error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
            console.error("[ACHIEVEMENT_TRACK_AFTER_CHORE_ERROR]", reason);
          }
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
          await emitFamilyActivityBestEffort({
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
            isRequesterAssignee(previousAssigneeId, session.uid, session.memberId, session.email) ||
            isRequesterAssignee(resolvedSingleAssigneeId, session.uid, session.memberId, session.email)
          ) {
            syncOwnerUid = session.uid;
          }
          if (resolvedSingleAssigneeId) {
            const activeChoreCount = await countActiveChoresForAssignee(
              familyId,
              resolvedSingleAssigneeId,
              idToken,
              choreId,
            );
            if (activeChoreCount >= MAX_ACTIVE_CHORES_PER_ASSIGNEE) {
              return { kind: "active_chore_limit_reached" as const };
            }
          }
          const resolvedAssigneeName =
            resolvedAssigneeScope === "family"
              ? "Family"
              : resolvedAssigneeIds.length > 1
                ? `${resolvedAssigneeIds.length} assignees`
                : resolvedSingleAssigneeId
                  ? await getFamilyMemberName(familyId, resolvedSingleAssigneeId, idToken)
                  : "Unassigned";
          const nextChoreType =
            resolvedAssigneeScope === "family" || resolvedAssigneeIds.length > 1
              ? "group"
              : normalizeChoreType(readString(existingChoreDoc.fields, "choreType"), "normal");
          await patchDocument(
            `families/${familyId}/chores/${choreId}`,
            {
              title: stringField(normalizedDescription),
              choreType: stringField(nextChoreType),
              assigneeId: stringField(resolvedSingleAssigneeId),
              assigneeIds: stringArrayField(resolvedAssigneeIds),
              assigneeScope: stringField(resolvedAssigneeScope),
              assigneeName: stringField(resolvedAssigneeName),
              dueDate: stringField(dueDate),
              details: stringField(details),
              categoryIds: stringArrayField(nextCategoryIds),
              coinValue: integerField(coinValue ?? DEFAULT_CHORE_COIN_VALUE),
              requireApproval: boolField(
                nextChoreType === "see_and_do" ||
                  resolvedAssigneeScope === "family" ||
                  resolvedAssigneeIds.length > 1
                  ? true
                  : requireApproval,
              ),
              recurrenceType: stringField(recurrence.recurrenceType),
              recurrenceInterval: integerField(recurrence.recurrenceInterval ?? 0),
              recurrenceUnit: stringField(recurrence.recurrenceUnit ?? ""),
              updatedAt: timestampField(now),
            },
            idToken,
            [
              "title",
              "choreType",
              "assigneeId",
              "assigneeIds",
              "assigneeScope",
              "assigneeName",
              "dueDate",
              "details",
              "categoryIds",
              "coinValue",
              "requireApproval",
              "recurrenceType",
              "recurrenceInterval",
              "recurrenceUnit",
              "updatedAt",
            ],
          );
          await emitFamilyActivityBestEffort({
            familyId,
            idToken,
            kind: "chore_edited",
            actorUid: session.uid,
            actorEmail: session.email,
            actorName,
            title: "Chore updated",
            message: `${actorName} updated "${normalizedDescription || previousTitle}" (${coinValue ?? DEFAULT_CHORE_COIN_VALUE} coins${requireApproval ? ", approval required" : ""}${recurrence.recurrenceType !== "none" ? `, ${recurrenceLabel(recurrence).toLowerCase()}` : ""}).`,
            choreId,
            choreTitle: normalizedDescription || previousTitle,
            relatedIds: Array.from(new Set([...resolvedAssigneeIds, previousAssigneeId].filter(Boolean))),
          });
          await publishFamilyActivity({
            type: "chore_updated",
            familyId,
            choreId,
            occurredAt: now,
          });
        }

        if (syncOwnerUid) {
          await syncGoogleTasksBestEffort({
            uid: syncOwnerUid,
            idToken,
            force: true,
            minIntervalSeconds: 0,
          });
        }

        return { kind: "ok" as const, newSkillBonus };
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
    if (data.kind === "wallet_permission_denied") {
      return NextResponse.json(
        {
          error: "wallet_permission_denied",
          message: "Missing permission to update wallet ledger for this chore transition.",
        },
        { status: 403 },
      );
    }
    if (data.kind === "recurring_successor_locked") {
      return NextResponse.json(
        {
          error: "recurring_successor_locked",
          message: "Cannot undo this completed recurring chore because the next occurrence already changed.",
        },
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

    const bonus = "newSkillBonus" in data ? data.newSkillBonus : undefined;
    const response = NextResponse.json(
      bonus && bonus.awarded
        ? {
            success: true,
            newSkillBonus: {
              awarded: true,
              amount: bonus.amount,
              totalCoins: bonus.totalCoins,
              playerUids: bonus.playerUids,
            },
          }
        : { success: true },
    );
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
        const choreAssigneeIds = await resolveChoreAssigneeIds(
          familyId,
          existingChoreDoc.fields,
          idToken,
        );
        const choreSource = readString(existingChoreDoc.fields, "source");
        const choreGoogleTaskOwnerUid = readString(existingChoreDoc.fields, "googleTaskOwnerUid");
        const currentStatus = readString(existingChoreDoc.fields, "status") || "Open";
        const choreCoinValue = normalizeCoinValue(readInteger(existingChoreDoc.fields, "coinValue"));
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
        await writeAuditLogBestEffort({
          familyId,
          idToken,
          eventType: "chore_status_changed",
          actor: {
            uid: session.uid,
            email: session.email,
            name: session.name || session.email,
            role: requester.role,
          },
          userId: choreAssigneeId,
          choreId,
          choreTitle,
          source: choreSource || "manual",
          previous: { status: currentStatus, deleted: readBoolean(existingChoreDoc.fields, "deleted") },
          next: { status: "Deleted", deleted: true },
          reason: "delete",
        });
        if (currentStatus === "Approved") {
          const payoutByAssignee = buildPayoutByAssignee({
            assigneeIds: choreAssigneeIds,
            totalCoinValue: choreCoinValue,
            storedPayoutsJson: readString(existingChoreDoc.fields, "approvalPayoutsJson"),
          });
          const payoutResult = await applyPayoutByAssignee({
            familyId,
            idToken,
            choreId,
            payoutByAssignee,
            direction: "debit",
            actorUid: session.uid,
            actorRole: requester.role,
            choreStatus: currentStatus,
          });
          if (payoutResult.kind === "wallet_negative_blocked") {
            return { kind: "wallet_negative_blocked" as const };
          }
          if (payoutResult.kind === "wallet_permission_denied") {
            return { kind: "wallet_permission_denied" as const };
          }
        }
        await emitFamilyActivityBestEffort({
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
          await syncGoogleTasksBestEffort({
            uid: choreGoogleTaskOwnerUid,
            idToken,
            force: true,
            minIntervalSeconds: 0,
          });
        } else if (isRequesterAssignee(choreAssigneeId, session.uid, session.memberId, session.email)) {
          await syncGoogleTasksBestEffort({
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
    if (data.kind === "wallet_negative_blocked") {
      return NextResponse.json(
        { error: "wallet_negative_blocked", message: "Cannot delete completed chore after coins were spent." },
        { status: 409 },
      );
    }
    if (data.kind === "wallet_permission_denied") {
      return NextResponse.json(
        {
          error: "wallet_permission_denied",
          message: "Missing permission to update wallet ledger for this chore transition.",
        },
        { status: 403 },
      );
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
