import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  boolField,
  createOrReplaceDocument,
  documentIdFromName,
  type FirestoreValue,
  getDocument,
  integerField,
  listDocuments,
  patchDocument,
  runQuery,
  readBoolean,
  readInteger,
  readString,
  readStringArray,
  readTimestamp,
  stringArrayField,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import { emitFamilyActivity } from "@/lib/notifications/events";
import { parseCompletionWindow, type CompletionWindow } from "@/lib/preferences/completion-window";
import { publishFamilyActivity } from "@/lib/ws/publish-family-activity";
import { createFamilySocketAuthToken } from "@/lib/ws/family-auth-token";
import { GOOGLE_TASKS_CHORE_SOURCE, syncGoogleTasksForUser } from "@/lib/google/tasks-sync";
import { rolloverOverdueRoutineAssignmentsBestEffort } from "@/lib/responsibility/assignment-service";
import { runAfterResponse } from "@/lib/async/after-response";
import { formatServerTiming } from "@/lib/observability/request-context";
import { resolveMemberPrimaryColor } from "@/lib/theme/member-primary-color";
import {
  type ChoreRecurrenceType,
  type ChoreRecurrenceWeekday,
  type ChoreRecurrenceUnit,
  normalizeCoinValue,
  normalizeRecurrenceConfig,
  parseCoinValue,
  parseRequireApproval,
  recurrenceLabel,
} from "@/lib/chores/recurrence";
import { normalizeChoreType, type ChoreType } from "@/lib/chores/types";
import {
  buildCategoryMap,
  hasAllCategoryIds,
  listFamilyCategories,
  normalizeCategoryIds,
  readChoreCategoryIds,
  resolveChoreCategories,
} from "@/lib/family/categories";
import type { FamilyCategory } from "@/lib/family/types";
import { trackAchievementEvent } from "@/lib/achievements/service";
import {
  normalizeResponsibilityPillar,
  type ResponsibilityPillar,
} from "@/lib/responsibility/types";
import { recordOperationMetric } from "@/lib/observability/metrics";
import {
  jsonReauthRequired,
  jsonUnauthorized,
  mapCommonFirestoreErrors,
} from "@/lib/chores/http-responses";
import {
  asDateOrToday,
  normalizeAssigneeIds,
  normalizeDescription,
  normalizeEmail,
  parseNewSkillEnabled,
  readOptionalSortOrder,
} from "@/lib/chores/input";
import { getPrimaryFamilyId, getViewerRole, isRequesterAssignee } from "@/lib/chores/access";
import { countActiveChoresForAssignee, getFamilyMemberName } from "@/lib/chores/assignees";

type CreateChoresBody = {
  description?: unknown;
  choreType?: unknown;
  assigneeId?: unknown;
  assigneeIds?: unknown;
  assigneeScope?: unknown;
  details?: unknown;
  titles?: unknown;
  dueDate?: unknown;
  categoryIds?: unknown;
  coinValue?: unknown;
  requireApproval?: unknown;
  newSkillEnabled?: unknown;
  recurrenceType?: unknown;
  recurrenceInterval?: unknown;
  recurrenceUnit?: unknown;
  recurrenceDays?: unknown;
  responsibilityPillar?: unknown;
};

type ReorderChoresBody = {
  action?: unknown;
  orderedChoreIds?: unknown;
};

type ChoreRow = {
  id: string;
  title: string;
  choreType: ChoreType;
  status: string;
  source: "manual" | "google_tasks";
  sortOrder?: number;
  assigneeId?: string;
  assigneeIds?: string[];
  assigneeScope?: "single" | "multiple" | "family";
  assigneeName: string;
  assigneeAvatarId?: string;
  assigneeAvatarPhotoUrl?: string;
  assigneePrimaryColor?: string;
  details?: string;
  dueDate: string;
  categoryIds: string[];
  categories: FamilyCategory[];
  completedAt?: string;
  coinValue: number;
  requireApproval: boolean;
  newSkillEnabled: boolean;
  recurrenceType: ChoreRecurrenceType;
  recurrenceInterval?: number;
  recurrenceUnit?: ChoreRecurrenceUnit;
  recurrenceDays?: ChoreRecurrenceWeekday[];
  responsibilityPillar?: ResponsibilityPillar;
  isGhost: boolean;
  routineAssignmentId?: string;
  routineId?: string;
  routineName?: string;
  routineStepOrder?: number;
  routineStepCount?: number;
  deleted: boolean;
  createdAt?: string;
  submittedAt?: string;
  updatedAt?: string;
};

type AssigneeDirectoryEntry = {
  id: string;
  name: string;
  avatarId?: string;
  avatarPhotoUrl?: string;
  primaryColor?: string;
};

type ViewerRole = "admin" | "player";
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;
const MAX_ACTIVE_CHORES_PER_ASSIGNEE = 100;
const FAMILY_ASSIGNEE_NAME = "Family";
const UNKNOWN_ASSIGNEE_NAME = "Unknown member";
const FAMILY_ASSIGNEE_FILTER_ID = "__family__";
type ChoreSortBy =
  | "sortOrder"
  | "title"
  | "status"
  | "assigneeName"
  | "dueDate"
  | "completedAt"
  | "coinValue";
type ChoreStatusFilter =
  | ""
  | "completed"
  | "needs_approval"
  | "open"
  | "recurring";
const MAX_CHORE_ARCHIVE = 5000;

// Reading the family chore archive with documents.list paginates serially
// (300 docs/page, up to ~17 back-to-back round-trips for a large family), which
// dominated the chores-list latency. A single runQuery streams the whole capped
// window back in one HTTP call instead. The read is intentionally left
// unfiltered/unordered so it matches the previous listAllDocuments behavior:
// adding a Firestore `where deleted==false` or `orderBy createdAt` would
// silently drop legacy chores that lack those fields. Deleted/sort/filter
// handling stays in JS exactly as before.
async function listFamilyChoreDocuments(familyId: string, idToken: string) {
  return runQuery(
    {
      from: [{ collectionId: "chores" }],
      limit: MAX_CHORE_ARCHIVE,
    },
    idToken,
    `families/${familyId}`,
  );
}
type CompletionWindowRange = {
  startMillis: number;
  endMillis: number;
};
const MINUTE_MILLIS = 60 * 1000;
const MAX_TIMEZONE_OFFSET_MINUTES = 14 * 60;

function toUnixMillis(value?: string) {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function usageKey(value: string) {
  const normalized = normalizeDescription(value).toLowerCase();
  const key = normalized
    .replace(/[^a-z0-9 ]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return key || "misc";
}

async function incrementUsageCount(
  path: string,
  description: string,
  idToken: string,
) {
  let currentCount = 0;
  try {
    const doc = await getDocument(path, idToken);
    currentCount = readInteger(doc.fields, "familyCount");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_HTTP_404")) {
      throw error;
    }
  }

  const now = new Date().toISOString();
  await createOrReplaceDocument(
    path,
    {
      description: stringField(description),
      normalized: stringField(description.toLowerCase()),
      familyCount: integerField(currentCount + 1),
      updatedAt: timestampField(now),
    },
    idToken,
  );
}

function normalizeChoreDoc(doc: {
  name: string;
  fields?: Record<string, FirestoreValue>;
}): ChoreRow {
  const sourceField = readString(doc.fields, "source");
  const title = readString(doc.fields, "title") || "Untitled chore";
  const googleTaskId = readString(doc.fields, "googleTaskId");
  const googleTaskListId = readString(doc.fields, "googleTaskListId");
  const googleTaskOwnerUid = readString(doc.fields, "googleTaskOwnerUid");
  const hasGoogleMetadata = Boolean(googleTaskId && googleTaskListId && googleTaskOwnerUid);
  const source = sourceField === GOOGLE_TASKS_CHORE_SOURCE ? "google_tasks" : "manual";
  const assigneeIds = readStringArray(doc.fields, "assigneeIds");
  const assigneeScope = readString(doc.fields, "assigneeScope");
  const recurrence = normalizeRecurrenceConfig({
    recurrenceType: readString(doc.fields, "recurrenceType"),
    recurrenceInterval: readInteger(doc.fields, "recurrenceInterval"),
    recurrenceUnit: readString(doc.fields, "recurrenceUnit"),
    recurrenceDays: readStringArray(doc.fields, "recurrenceDays"),
  });
  return {
    id: documentIdFromName(doc.name),
    title,
    choreType: normalizeChoreType(
      readString(doc.fields, "choreType"),
      assigneeScope === "family" || assigneeIds.length > 1 ? "group" : "normal",
    ),
    status: readString(doc.fields, "status") || "Open",
    source,
    sortOrder: readOptionalSortOrder(doc.fields),
    assigneeId: readString(doc.fields, "assigneeId") || undefined,
    assigneeIds,
    assigneeScope:
      assigneeScope === "family"
        ? "family"
        : assigneeScope === "multiple"
          ? "multiple"
          : "single",
    assigneeName: readString(doc.fields, "assigneeName") || UNKNOWN_ASSIGNEE_NAME,
    details: readString(doc.fields, "details") || undefined,
    dueDate: readString(doc.fields, "dueDate"),
    categoryIds: readChoreCategoryIds(doc.fields),
    categories: [],
    submittedAt: readTimestamp(doc.fields, "submittedAt") || undefined,
    updatedAt: readTimestamp(doc.fields, "updatedAt") || undefined,
    coinValue: normalizeCoinValue(readInteger(doc.fields, "coinValue")),
    requireApproval: readBoolean(doc.fields, "requireApproval"),
    newSkillEnabled:
      doc.fields && Object.prototype.hasOwnProperty.call(doc.fields, "newSkillEnabled")
        ? readBoolean(doc.fields, "newSkillEnabled")
        : true,
    recurrenceType: recurrence.recurrenceType,
    recurrenceInterval: recurrence.recurrenceInterval,
    recurrenceUnit: recurrence.recurrenceUnit,
    recurrenceDays: recurrence.recurrenceDays,
    responsibilityPillar:
      normalizeResponsibilityPillar(readString(doc.fields, "responsibilityPillar")) || undefined,
    // Ghost chores (AI-suggested) carry a "ghost_chore" source and a
    // ghostSuggestionId, but the `source` field above collapses to manual; expose
    // an explicit flag so the Approval Inbox can label them as Ghost Chores.
    isGhost:
      readString(doc.fields, "source") === "ghost_chore" ||
      Boolean(readString(doc.fields, "ghostSuggestionId")),
    routineAssignmentId: readString(doc.fields, "routineAssignmentId") || undefined,
    routineId: readString(doc.fields, "routineId") || undefined,
    routineName: readString(doc.fields, "routineName") || undefined,
    routineStepOrder: readInteger(doc.fields, "routineStepOrder") || undefined,
    routineStepCount: readInteger(doc.fields, "routineStepCount") || undefined,
    deleted: readBoolean(doc.fields, "deleted"),
    createdAt: readTimestamp(doc.fields, "createdAt") || undefined,
  };
}

function parsePositiveInt(value: string | null, fallback: number) {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const normalized = Math.trunc(parsed);
  if (normalized <= 0) {
    return fallback;
  }
  return normalized;
}

function paginate<T>(rows: T[], page: number, pageSize: number) {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.max(1, Math.min(page, totalPages));
  const offset = (safePage - 1) * pageSize;
  return {
    rows: rows.slice(offset, offset + pageSize),
    total,
    totalPages,
    page: safePage,
    pageSize,
  };
}

function parseSortBy(value: string | null): ChoreSortBy {
  if (
    value === "sortOrder" ||
    value === "title" ||
    value === "status" ||
    value === "assigneeName" ||
    value === "dueDate" ||
    value === "completedAt" ||
    value === "coinValue"
  ) {
    return value;
  }
  return "sortOrder";
}

function parseSortDir(value: string | null) {
  return value === "desc" ? "desc" : "asc";
}

function normalizeSearch(value: string | null) {
  return (value ?? "").trim().toLowerCase();
}

function normalizeOrderedChoreIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const orderedIds: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    orderedIds.push(trimmed);
  }
  return orderedIds;
}

function parseStatusFilter(value: string | null): ChoreStatusFilter {
  if (
    value === "completed" ||
    value === "needs_approval" ||
    value === "open" ||
    value === "recurring"
  ) {
    return value;
  }
  return "";
}

function parseAssigneeFilters(values: string[]) {
  const seen = new Set<string>();
  for (const raw of values) {
    for (const part of raw.split(",")) {
      const trimmed = part.trim();
      if (trimmed) {
        seen.add(trimmed);
      }
    }
  }
  return Array.from(seen);
}

function parseCategoryFilter(values: string[]) {
  const seen = new Set<string>();
  for (const raw of values) {
    for (const part of raw.split(",")) {
      const trimmed = part.trim();
      if (trimmed) {
        seen.add(trimmed);
      }
    }
  }
  return seen;
}

function parseChoreTypeFilter(values: string[]) {
  const seen = new Set<ChoreType>();
  for (const raw of values) {
    for (const part of raw.split(",")) {
      const trimmed = part.trim();
      if (trimmed === "normal" || trimmed === "group" || trimmed === "see_and_do") {
        seen.add(trimmed);
      }
    }
  }
  return seen;
}

function parseRecurrenceTypeFilter(values: string[]) {
  const seen = new Set<ChoreRecurrenceType>();
  for (const raw of values) {
    for (const part of raw.split(",")) {
      const trimmed = part.trim();
      if (
        trimmed === "none" ||
        trimmed === "instant" ||
        trimmed === "daily" ||
        trimmed === "weekly" ||
        trimmed === "monthly" ||
        trimmed === "custom"
      ) {
        seen.add(trimmed);
      }
    }
  }
  return seen;
}

function parseApprovalFilter(value: string | null): "yes" | "no" | "" {
  if (value === "yes" || value === "no") {
    return value;
  }
  return "";
}

function parseOptionalInt(value: string | null) {
  if (value === null || value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.trunc(parsed);
}

function parseIsoDate(value: string | null) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  return "";
}

function parseTimezoneOffsetMinutes(value: string | null) {
  if (value === null) {
    return 0;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  const rounded = Math.trunc(parsed);
  if (Math.abs(rounded) > MAX_TIMEZONE_OFFSET_MINUTES) {
    return 0;
  }
  return rounded;
}

function startOfUtcDayMillis(value: number) {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

function startOfUtcWeekMillis(value: number) {
  const date = new Date(startOfUtcDayMillis(value));
  const dayOffset = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - dayOffset);
  return date.getTime();
}

function startOfUtcMonthMillis(value: number) {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0);
}

function startOfUtcYearMillis(value: number) {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), 0, 1, 0, 0, 0, 0);
}

function toShiftedUtcMillis(value: number, timezoneOffsetMinutes: number) {
  return value - timezoneOffsetMinutes * MINUTE_MILLIS;
}

function offsetIsoDateAt(value: number, timezoneOffsetMinutes: number) {
  return new Date(toShiftedUtcMillis(value, timezoneOffsetMinutes))
    .toISOString()
    .slice(0, 10);
}

function fromShiftedUtcMillis(value: number, timezoneOffsetMinutes: number) {
  return value + timezoneOffsetMinutes * MINUTE_MILLIS;
}

function startOfOffsetDayMillis(value: number, timezoneOffsetMinutes: number) {
  return fromShiftedUtcMillis(
    startOfUtcDayMillis(toShiftedUtcMillis(value, timezoneOffsetMinutes)),
    timezoneOffsetMinutes,
  );
}

function startOfOffsetWeekMillis(value: number, timezoneOffsetMinutes: number) {
  return fromShiftedUtcMillis(
    startOfUtcWeekMillis(toShiftedUtcMillis(value, timezoneOffsetMinutes)),
    timezoneOffsetMinutes,
  );
}

function startOfOffsetMonthMillis(value: number, timezoneOffsetMinutes: number) {
  return fromShiftedUtcMillis(
    startOfUtcMonthMillis(toShiftedUtcMillis(value, timezoneOffsetMinutes)),
    timezoneOffsetMinutes,
  );
}

function startOfOffsetYearMillis(value: number, timezoneOffsetMinutes: number) {
  return fromShiftedUtcMillis(
    startOfUtcYearMillis(toShiftedUtcMillis(value, timezoneOffsetMinutes)),
    timezoneOffsetMinutes,
  );
}

function getCompletionWindowRange(
  window: CompletionWindow,
  timezoneOffsetMinutes: number,
): CompletionWindowRange {
  const nowMillis = Date.now();
  if (window === "today") {
    return {
      startMillis: startOfOffsetDayMillis(nowMillis, timezoneOffsetMinutes),
      endMillis: nowMillis,
    };
  }
  if (window === "week") {
    return {
      startMillis: startOfOffsetWeekMillis(nowMillis, timezoneOffsetMinutes),
      endMillis: nowMillis,
    };
  }
  if (window === "month") {
    return {
      startMillis: startOfOffsetMonthMillis(nowMillis, timezoneOffsetMinutes),
      endMillis: nowMillis,
    };
  }
  return {
    startMillis: startOfOffsetYearMillis(nowMillis, timezoneOffsetMinutes),
    endMillis: nowMillis,
  };
}

function dueDateToIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return "";
  }
  return `${value}T00:00:00.000Z`;
}

function isCompletedStatus(status: string) {
  return status === "Submitted" || status === "Approved";
}

function buildAssigneeAliasToMemberId(
  memberDocs: Array<{ name: string; fields?: Record<string, FirestoreValue> }>,
) {
  const rawMembers = memberDocs
    .map((doc) => ({
      id: documentIdFromName(doc.name),
      uid: readString(doc.fields, "uid") || undefined,
      email: readString(doc.fields, "email"),
      deleted: readBoolean(doc.fields, "deleted"),
    }))
    .filter((member) => !member.deleted);

  const normalizedEmailWithUid = new Set(
    rawMembers
      .filter((member) => Boolean(member.uid))
      .map((member) => normalizeEmail(member.email))
      .filter(Boolean),
  );
  const canonicalMembers = rawMembers.filter((member) => {
    if (member.uid) {
      return true;
    }
    const normalizedEmail = normalizeEmail(member.email);
    if (!normalizedEmail) {
      return true;
    }
    return !normalizedEmailWithUid.has(normalizedEmail);
  });

  const canonicalByEmail = new Map(
    canonicalMembers
      .map((member) => [normalizeEmail(member.email), member.id] as const)
      .filter(([email]) => Boolean(email)),
  );

  const aliasToMemberId = new Map<string, string>();
  for (const member of canonicalMembers) {
    aliasToMemberId.set(member.id, member.id);
    if (member.uid) {
      aliasToMemberId.set(member.uid, member.id);
    }
    const normalizedEmail = normalizeEmail(member.email);
    if (normalizedEmail) {
      aliasToMemberId.set(normalizedEmail, member.id);
    }
  }

  for (const member of rawMembers) {
    const normalizedEmail = normalizeEmail(member.email);
    if (!normalizedEmail) {
      continue;
    }
    const canonicalId = canonicalByEmail.get(normalizedEmail);
    if (!canonicalId) {
      continue;
    }
    aliasToMemberId.set(member.id, canonicalId);
    if (member.uid) {
      aliasToMemberId.set(member.uid, canonicalId);
    }
    aliasToMemberId.set(normalizedEmail, canonicalId);
  }

  return aliasToMemberId;
}

function canonicalizeAssigneeFilter(
  value: string,
  assigneeAliasToMemberId: Map<string, string>,
) {
  if (value === FAMILY_ASSIGNEE_FILTER_ID) {
    return FAMILY_ASSIGNEE_FILTER_ID;
  }
  return (
    assigneeAliasToMemberId.get(value) ??
    assigneeAliasToMemberId.get(normalizeEmail(value)) ??
    value
  );
}

function getChoreAssigneeTargets(
  doc: Pick<ChoreRow, "assigneeId" | "assigneeIds" | "assigneeScope">,
  assigneeAliasToMemberId: Map<string, string>,
) {
  const targets = new Set<string>();
  if (doc.assigneeScope === "family") {
    targets.add(FAMILY_ASSIGNEE_FILTER_ID);
    return targets;
  }
  for (const assigneeId of doc.assigneeIds ?? []) {
    const canonicalAssigneeId = canonicalizeAssigneeFilter(assigneeId, assigneeAliasToMemberId);
    if (canonicalAssigneeId) {
      targets.add(canonicalAssigneeId);
    }
  }
  if (doc.assigneeId) {
    const canonicalAssigneeId = canonicalizeAssigneeFilter(doc.assigneeId, assigneeAliasToMemberId);
    if (canonicalAssigneeId) {
      targets.add(canonicalAssigneeId);
    }
  }
  return targets;
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

function choreCompletedAt(doc: ChoreRow) {
  if (doc.status === "Submitted" || doc.status === "Approved") {
    return doc.submittedAt || doc.updatedAt || "";
  }
  return "";
}

function choreMatchesQuery(doc: ChoreRow, query: string) {
  if (query.length < 3) {
    return true;
  }
  const completedAt = choreCompletedAt(doc);
  const typeLabel =
    doc.choreType === "group"
      ? "group group chore"
      : doc.choreType === "see_and_do"
        ? "see and do see-and-do suggested chore"
        : "normal normal chore";
  const statusLabel =
    doc.status === "Submitted" && doc.requireApproval
      ? "submitted completed awaiting approval needs approval"
      : isCompletedStatus(doc.status)
        ? "completed submitted approved"
        : doc.status === "Open"
          ? "open"
          : doc.status.toLowerCase();
  const approvalLabel = doc.requireApproval
    ? "approval required requires approval yes"
    : "no approval approval not required no";
  const recurrenceText =
    doc.recurrenceType === "none"
      ? "one time no repeat none"
      : `${doc.recurrenceType} recurring repeats ${recurrenceLabel(doc).toLowerCase()}`;
  const haystack = [
    doc.id,
    doc.title,
    doc.status,
    statusLabel,
    doc.assigneeName,
    doc.assigneeId ?? "",
    doc.details ?? "",
    doc.dueDate,
    completedAt,
    completedAt.slice(0, 10),
    String(doc.coinValue),
    `${doc.coinValue} coins`,
    typeLabel,
    approvalLabel,
    recurrenceText,
    doc.categories.map((category) => category.name).join(" "),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function compareValues(a: string | number, b: string | number) {
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }
  return String(a).localeCompare(String(b));
}

function compareBySortOrderOrOldest(
  a: Pick<ChoreRow, "sortOrder" | "createdAt" | "id">,
  b: Pick<ChoreRow, "sortOrder" | "createdAt" | "id">,
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

function sortChores(rows: ChoreRow[], sortBy: ChoreSortBy, sortDir: "asc" | "desc") {
  const direction = sortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const valueA =
      sortBy === "sortOrder"
        ? a.sortOrder ?? Number.MAX_SAFE_INTEGER
        : sortBy === "title"
        ? a.title
        : sortBy === "status"
          ? a.status
          : sortBy === "assigneeName"
            ? a.assigneeName
            : sortBy === "dueDate"
              ? a.dueDate
              : sortBy === "completedAt"
                ? choreCompletedAt(a)
                : a.coinValue;
    const valueB =
      sortBy === "sortOrder"
        ? b.sortOrder ?? Number.MAX_SAFE_INTEGER
        : sortBy === "title"
        ? b.title
        : sortBy === "status"
          ? b.status
          : sortBy === "assigneeName"
            ? b.assigneeName
            : sortBy === "dueDate"
              ? b.dueDate
              : sortBy === "completedAt"
                ? choreCompletedAt(b)
                : b.coinValue;
    if (sortBy === "sortOrder") {
      const compared = compareBySortOrderOrOldest(a, b);
      if (compared !== 0) {
        return compared * direction;
      }
      return 0;
    }
    const primaryCompared = compareValues(valueA, valueB);
    if (primaryCompared !== 0) {
      return primaryCompared * direction;
    }
    return compareBySortOrderOrOldest(a, b);
  });
}

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  const requestedPage = parsePositiveInt(request.nextUrl.searchParams.get("page"), 1);
  const requestedLimit = parsePositiveInt(request.nextUrl.searchParams.get("limit"), DEFAULT_PAGE_SIZE);
  const pageSize = Math.min(MAX_PAGE_SIZE, requestedLimit);
  const sortBy = parseSortBy(request.nextUrl.searchParams.get("sortBy"));
  const sortDir = parseSortDir(request.nextUrl.searchParams.get("sortDir"));
  const query = normalizeSearch(request.nextUrl.searchParams.get("q"));
  const assigneeFilters = parseAssigneeFilters(request.nextUrl.searchParams.getAll("assigneeId"));
  const statusFilter = parseStatusFilter(request.nextUrl.searchParams.get("status"));
  const categoryFilter = parseCategoryFilter(
    request.nextUrl.searchParams.getAll("categoryId"),
  );
  const choreTypeFilter = parseChoreTypeFilter(request.nextUrl.searchParams.getAll("choreType"));
  const recurrenceTypeFilter = parseRecurrenceTypeFilter(
    request.nextUrl.searchParams.getAll("recurrenceType"),
  );
  const approvalFilter = parseApprovalFilter(request.nextUrl.searchParams.get("requireApproval"));
  const coinMinFilter = parseOptionalInt(request.nextUrl.searchParams.get("coinMin"));
  const coinMaxFilter = parseOptionalInt(request.nextUrl.searchParams.get("coinMax"));
  const dueFromFilter = parseIsoDate(request.nextUrl.searchParams.get("dueFrom"));
  const dueToFilter = parseIsoDate(request.nextUrl.searchParams.get("dueTo"));
  const completedFromFilter = parseIsoDate(request.nextUrl.searchParams.get("completedFrom"));
  const completedToFilter = parseIsoDate(request.nextUrl.searchParams.get("completedTo"));
  const completionWindow = parseCompletionWindow(request.nextUrl.searchParams.get("completedWindow"));
  const timezoneOffsetMinutes = parseTimezoneOffsetMinutes(
    request.nextUrl.searchParams.get("tzOffsetMinutes"),
  );
  const completionWindowRange = completionWindow
    ? getCompletionWindowRange(completionWindow, timezoneOffsetMinutes)
    : null;
  const operationStartedAt = Date.now();
  try {
    const { data, session: refreshedSession, refreshed, timing } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        let familyId = "";
        let viewerGoogleTasksLinked = false;
        try {
          const userDoc = await getDocument(`users/${session.uid}`, idToken);
          familyId = readStringArray(userDoc.fields, "familyIds")[0] ?? "";
          viewerGoogleTasksLinked = readBoolean(userDoc.fields, "googleTasksLinked");
        } catch (error) {
          const reason = error instanceof Error ? error.message : "";
          if (
            reason.includes("FIRESTORE_HTTP_404") &&
            reason.toLowerCase().includes("document") &&
            reason.toLowerCase().includes("not found")
          ) {
            return {
              chores: [] as ChoreRow[],
              viewerRole: "player" as ViewerRole,
              viewerUid: session.uid,
              viewerGoogleTasksLinked,
              familyId: "",
              wsAuthToken: "",
            };
          }
          throw error;
        }

        if (!familyId) {
          return {
            chores: [] as ChoreRow[],
            viewerRole: "player" as ViewerRole,
            viewerUid: session.uid,
            viewerGoogleTasksLinked,
            familyId: "",
            wsAuthToken: "",
          };
        }
        // The Google Tasks sync makes external Google API calls (plus its own
        // archive read) and was previously awaited on every chores-list request,
        // blocking the response even for the majority of users who have never
        // linked Google Tasks. We already know the viewer's link state from the
        // user doc above, so skip the sync entirely when it can't do anything.
        if (viewerGoogleTasksLinked) {
          await runAfterResponse("chores:google-tasks-sync", () =>
            syncGoogleTasksForUser({
              uid: session.uid,
              idToken,
              minIntervalSeconds: 60,
            }),
          );
        }
        // Rolling overdue routine assignments forward is a write loop on a read
        // path. This is the same deferral already applied to /api/family/summary;
        // it was missed here, and this route is the slowest on the dashboard
        // (2374ms measured in isolation in production).
        // Trade-off matches summary: the first load after an assignment goes
        // overdue renders the pre-rollover due date, the next one shows it moved.
        await runAfterResponse("chores:routine-rollover", () =>
          rolloverOverdueRoutineAssignmentsBestEffort({
            familyId,
            idToken,
            today: offsetIsoDateAt(Date.now(), timezoneOffsetMinutes),
            actor: { uid: session.uid, email: session.email, name: session.name },
          }),
        );

        const [viewerRole, memberDocs, docs, categories] = await Promise.all([
          getViewerRole(familyId, session.uid, idToken),
          listDocuments(`families/${familyId}/members`, idToken, 200),
          listFamilyChoreDocuments(familyId, idToken),
          listFamilyCategories(familyId, idToken),
        ]);
        const categoryMap = buildCategoryMap(categories);
        const assigneeAliasToMemberId = buildAssigneeAliasToMemberId(memberDocs);
        const viewerAssigneeAliases = buildViewerAssigneeAliases(memberDocs, session.uid, session.email);
        const targetAssigneeIds = assigneeFilters.map((assigneeFilter) =>
          canonicalizeAssigneeFilter(assigneeFilter, assigneeAliasToMemberId),
        );
        const assigneeAvatarByAlias = new Map<string, string>();
        const assigneeAvatarPhotoByAlias = new Map<string, string>();
        const assigneePrimaryColorByAlias = new Map<string, string>();
        const assigneeDirectoryByAlias = new Map<string, AssigneeDirectoryEntry>();
        for (const memberDoc of memberDocs) {
          if (readBoolean(memberDoc.fields, "deleted")) {
            continue;
          }
          const memberId = documentIdFromName(memberDoc.name);
          const memberName = readString(memberDoc.fields, "name") || "Family member";
          const avatarId = readString(memberDoc.fields, "avatarId");
          const avatarPhotoUrl = readString(memberDoc.fields, "avatarPhotoUrl");
          const primaryColor = resolveMemberPrimaryColor(
            readString(memberDoc.fields, "dashboardPrimaryColor") || undefined,
          );
          const directoryEntry: AssigneeDirectoryEntry = {
            id: memberId,
            name: memberName,
            avatarId: avatarId || undefined,
            avatarPhotoUrl: avatarPhotoUrl || undefined,
            primaryColor,
          };
          assigneeDirectoryByAlias.set(memberId, directoryEntry);
          if (avatarId) {
            assigneeAvatarByAlias.set(memberId, avatarId);
          }
          if (avatarPhotoUrl) {
            assigneeAvatarPhotoByAlias.set(memberId, avatarPhotoUrl);
          }
          assigneePrimaryColorByAlias.set(memberId, primaryColor);
          const memberUid = readString(memberDoc.fields, "uid");
          if (memberUid) {
            assigneeDirectoryByAlias.set(memberUid, directoryEntry);
            if (avatarId) {
              assigneeAvatarByAlias.set(memberUid, avatarId);
            }
            if (avatarPhotoUrl) {
              assigneeAvatarPhotoByAlias.set(memberUid, avatarPhotoUrl);
            }
            assigneePrimaryColorByAlias.set(memberUid, primaryColor);
          }
          const normalizedEmail = normalizeEmail(readString(memberDoc.fields, "email"));
          if (normalizedEmail) {
            assigneeDirectoryByAlias.set(normalizedEmail, directoryEntry);
            if (avatarId) {
              assigneeAvatarByAlias.set(normalizedEmail, avatarId);
            }
            if (avatarPhotoUrl) {
              assigneeAvatarPhotoByAlias.set(normalizedEmail, avatarPhotoUrl);
            }
            assigneePrimaryColorByAlias.set(normalizedEmail, primaryColor);
          }
        }
        // The archive table shows every non-deleted chore the family has ever
        // had (including chores scheduled in the future), so unlike the legacy
        // dashboard read there is no "hide chores due >24h ahead" filter here.
        const activeChores = docs
          .map((doc) => {
            const chore = normalizeChoreDoc(doc);
            return {
              ...chore,
              categories: resolveChoreCategories(chore.categoryIds, categoryMap),
            };
          })
          .filter((doc) => !doc.deleted);
        const totalUnfiltered = activeChores.length;
        const filteredChores = activeChores
          .filter((doc) => {
            if (statusFilter === "") {
              return true;
            }
            if (statusFilter === "completed") {
              return isCompletedStatus(doc.status);
            }
            if (statusFilter === "needs_approval") {
              return doc.status === "Submitted" && doc.requireApproval;
            }
            if (statusFilter === "open") {
              return doc.status === "Open";
            }
            if (statusFilter === "recurring") {
              return doc.recurrenceType !== "none";
            }
            return true;
          })
          .filter((doc) => {
            if (categoryFilter.size === 0) {
              return true;
            }
            return doc.categoryIds.some((categoryId) => categoryFilter.has(categoryId));
          })
          .filter((doc) => {
            if (choreTypeFilter.size === 0) {
              return true;
            }
            return choreTypeFilter.has(doc.choreType);
          })
          .filter((doc) => {
            if (recurrenceTypeFilter.size === 0) {
              return true;
            }
            return recurrenceTypeFilter.has(doc.recurrenceType);
          })
          .filter((doc) => {
            if (!approvalFilter) {
              return true;
            }
            return approvalFilter === "yes" ? doc.requireApproval : !doc.requireApproval;
          })
          .filter((doc) => {
            if (coinMinFilter !== null && doc.coinValue < coinMinFilter) {
              return false;
            }
            if (coinMaxFilter !== null && doc.coinValue > coinMaxFilter) {
              return false;
            }
            return true;
          })
          .filter((doc) => {
            if (!dueFromFilter && !dueToFilter) {
              return true;
            }
            if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.dueDate)) {
              return false;
            }
            if (dueFromFilter && doc.dueDate < dueFromFilter) {
              return false;
            }
            if (dueToFilter && doc.dueDate > dueToFilter) {
              return false;
            }
            return true;
          })
          .filter((doc) => {
            if (!completedFromFilter && !completedToFilter) {
              return true;
            }
            const completedDate = choreCompletedAt(doc).slice(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(completedDate)) {
              return false;
            }
            if (completedFromFilter && completedDate < completedFromFilter) {
              return false;
            }
            if (completedToFilter && completedDate > completedToFilter) {
              return false;
            }
            return true;
          })
          .filter((doc) => {
            if (targetAssigneeIds.length === 0) {
              return true;
            }
            const choreAssigneeTargets = getChoreAssigneeTargets(doc, assigneeAliasToMemberId);
            return targetAssigneeIds.every((targetAssigneeId) =>
              choreAssigneeTargets.has(targetAssigneeId),
            );
          })
          .filter((doc) => {
            if (!completionWindowRange) {
              return true;
            }
            if (!isCompletedStatus(doc.status)) {
              return false;
            }
            const completedAt = choreCompletedAt(doc) || dueDateToIso(doc.dueDate);
            const completedAtMillis = toUnixMillis(completedAt);
            if (!completedAtMillis) {
              return false;
            }
            return (
              completedAtMillis >= completionWindowRange.startMillis &&
              completedAtMillis <= completionWindowRange.endMillis
            );
          })
          .filter((doc) => choreMatchesQuery(doc, query));
        const chores = sortChores(filteredChores, sortBy, sortDir)
          .map((doc) => ({
            id: doc.id,
            title: doc.title,
            choreType: doc.choreType,
            status: doc.status,
            source: doc.source,
            sortOrder: doc.sortOrder,
            assigneeId: doc.assigneeId,
            assigneeIds: doc.assigneeIds,
            assigneeScope: doc.assigneeScope,
            assigneeName: doc.assigneeName,
            assigneeAvatarId: doc.assigneeId
              ? assigneeAvatarByAlias.get(doc.assigneeId) ??
                assigneeAvatarByAlias.get(normalizeEmail(doc.assigneeId))
              : undefined,
            assigneeAvatarPhotoUrl: doc.assigneeId
              ? assigneeAvatarPhotoByAlias.get(doc.assigneeId) ??
                assigneeAvatarPhotoByAlias.get(normalizeEmail(doc.assigneeId))
              : undefined,
            assigneePrimaryColor: doc.assigneeId
              ? assigneePrimaryColorByAlias.get(doc.assigneeId) ??
                assigneePrimaryColorByAlias.get(normalizeEmail(doc.assigneeId))
              : undefined,
            details: doc.details,
            categoryIds: doc.categoryIds,
            categories: doc.categories,
            dueDate: doc.dueDate,
            completedAt:
              doc.status === "Submitted" || doc.status === "Approved"
                ? doc.submittedAt || doc.updatedAt || undefined
                : undefined,
            coinValue: doc.coinValue,
            requireApproval: doc.requireApproval,
            isGhost: doc.isGhost,
            recurrenceType: doc.recurrenceType,
            recurrenceInterval: doc.recurrenceInterval,
            recurrenceUnit: doc.recurrenceUnit,
            recurrenceDays: doc.recurrenceDays,
            responsibilityPillar: doc.responsibilityPillar,
            routineAssignmentId: doc.routineAssignmentId,
            routineId: doc.routineId,
            routineName: doc.routineName,
            routineStepOrder: doc.routineStepOrder,
            routineStepCount: doc.routineStepCount,
            createdAt: doc.createdAt,
          }));

        const pagination = paginate(chores, requestedPage, pageSize);
        return {
          chores: pagination.rows,
          viewerRole,
          viewerUid: session.uid,
          viewerGoogleTasksLinked,
          viewerAssigneeAliases,
          familyId,
          wsAuthToken: createFamilySocketAuthToken({
            uid: session.uid,
            familyIds: [familyId],
          }),
          assigneeDirectory: Array.from(new Map(
            Array.from(assigneeDirectoryByAlias.values()).map((entry) => [entry.id, entry] as const),
          ).values()),
          familyCategories: categories,
          totalUnfiltered,
          pagination: {
            page: pagination.page,
            pageSize: pagination.pageSize,
            total: pagination.total,
            totalPages: pagination.totalPages,
          },
        };
      });

    const response = NextResponse.json(data);
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    response.headers.set("Server-Timing", formatServerTiming(timing));
    const choresPagination = "pagination" in data ? data.pagination : undefined;
    void recordOperationMetric({
      area: "chores",
      operation: "list",
      durationMs: Date.now() - operationStartedAt,
      status: "ok",
      resultCount: data.chores.length,
      requestedLimit: pageSize,
      // The route returns full pagination metadata to its caller, so the cursor
      // is "consumed"; risk here is driven by result_count === page_size.
      hasNextPage: choresPagination ? choresPagination.page < choresPagination.totalPages : false,
      cursorConsumed: true,
      familyId: data.familyId,
      userId: session.uid,
      metadata: {
        page: choresPagination?.page ?? 1,
        totalPages: choresPagination?.totalPages ?? 1,
        total: choresPagination?.total ?? data.chores.length,
      },
    });
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[CHORES_LIST_ERROR]", reason);
    void recordOperationMetric({
      area: "chores",
      operation: "list",
      durationMs: Date.now() - operationStartedAt,
      status: "error",
      errorCode: reason,
      requestedLimit: pageSize,
      userId: session.uid,
    });
    const mapped = mapCommonFirestoreErrors(reason);
    if (mapped) {
      return mapped;
    }
    return NextResponse.json({ error: "chores_unavailable" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  let body: ReorderChoresBody;
  try {
    body = (await request.json()) as ReorderChoresBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  if (action !== "reorder") {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }
  const orderedChoreIds = normalizeOrderedChoreIds(body.orderedChoreIds);
  if (orderedChoreIds.length === 0) {
    return NextResponse.json({ error: "ordered_chore_ids_required" }, { status: 400 });
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

        const docs = await listFamilyChoreDocuments(familyId, idToken);
        const openChores = docs
          .map((doc) => normalizeChoreDoc(doc))
          .filter((doc) => !doc.deleted && doc.status === "Open")
          .sort((a, b) => compareBySortOrderOrOldest(a, b));
        if (openChores.length === 0) {
          return { kind: "ok" as const, updatedCount: 0 };
        }

        const openById = new Map(openChores.map((chore) => [chore.id, chore] as const));
        const seenOrderedIds = new Set<string>();
        for (const choreId of orderedChoreIds) {
          if (!openById.has(choreId) || seenOrderedIds.has(choreId)) {
            return { kind: "invalid_ordered_chore_ids" as const };
          }
          seenOrderedIds.add(choreId);
        }
        const mergedOrderedIds = [
          ...orderedChoreIds,
          ...openChores
            .map((chore) => chore.id)
            .filter((choreId) => !seenOrderedIds.has(choreId)),
        ];

        const now = new Date().toISOString();
        const changedOpenChores = mergedOrderedIds
          .map((id, index) => ({ id, sortOrder: index }))
          .filter((entry) => openById.get(entry.id)?.sortOrder !== entry.sortOrder);
        await Promise.all(
          changedOpenChores.map((entry) =>
            patchDocument(
              `families/${familyId}/chores/${entry.id}`,
              {
                updatedAt: timestampField(now),
                sortOrder: integerField(entry.sortOrder),
              },
              idToken,
              ["updatedAt", "sortOrder"],
            ),
          ),
        );

        await publishFamilyActivity({
          type: "chore_reordered",
          familyId,
          occurredAt: now,
        });

        return { kind: "ok" as const, updatedCount: changedOpenChores.length };
      });

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "forbidden_action") {
      return NextResponse.json({ error: "forbidden_action" }, { status: 403 });
    }
    if (data.kind === "invalid_ordered_chore_ids") {
      return NextResponse.json({ error: "invalid_ordered_chore_ids" }, { status: 400 });
    }

    const response = NextResponse.json({ success: true, updated: data.updatedCount });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[CHORES_REORDER_ERROR]", reason);
    const mapped = mapCommonFirestoreErrors(reason);
    if (mapped) {
      return mapped;
    }
    return NextResponse.json({ error: "reorder_chores_failed" }, { status: 500 });
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

  let body: CreateChoresBody;
  try {
    body = (await request.json()) as CreateChoresBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const dueDate = asDateOrToday(body.dueDate);
  const details =
    typeof body.details === "string" && body.details.trim().length > 0
      ? body.details.trim().slice(0, 2000)
      : "";
  const assigneeId =
    typeof body.assigneeId === "string" && body.assigneeId.trim().length > 0
      ? body.assigneeId.trim()
      : "";
  const assigneeIds = normalizeAssigneeIds(body.assigneeIds);
  const assigneeScopeInput =
    body.assigneeScope === "family" || body.assigneeScope === "multiple" || body.assigneeScope === "single"
      ? body.assigneeScope
      : "";
  const resolvedAssigneeScope =
    assigneeScopeInput || (assigneeIds.length > 1 ? "multiple" : assigneeIds.length === 1 ? "single" : "single");
  const resolvedAssigneeIds = assigneeIds.length > 0 ? assigneeIds : assigneeId ? [assigneeId] : [];
  const resolvedSingleAssigneeId =
    resolvedAssigneeScope === "single" && resolvedAssigneeIds.length === 1 ? resolvedAssigneeIds[0] : "";
  const categoryIds = normalizeCategoryIds(body.categoryIds);
  const coinValue = parseCoinValue(body.coinValue);
  const requestedChoreType =
    typeof body.choreType === "string" ? normalizeChoreType(body.choreType, "normal") : "normal";
  const requireApproval = parseRequireApproval(body.requireApproval);
  const newSkillEnabled = parseNewSkillEnabled(body.newSkillEnabled);
  const responsibilityPillar = normalizeResponsibilityPillar(body.responsibilityPillar);
  const recurrence = normalizeRecurrenceConfig({
    recurrenceType: body.recurrenceType,
    recurrenceInterval: body.recurrenceInterval,
    recurrenceUnit: body.recurrenceUnit,
    recurrenceDays: body.recurrenceDays,
  });
  const descriptionFromSingle =
    typeof body.description === "string" ? normalizeDescription(body.description) : "";
  const titlesInput = Array.isArray(body.titles) ? body.titles : [];
  const titlesFromList = titlesInput
    .filter((entry): entry is string => typeof entry === "string")
    .map((title) => normalizeDescription(title))
    .filter((title) => title.length > 0)
    .slice(0, 100);
  const titles = descriptionFromSingle ? [descriptionFromSingle] : titlesFromList;

  if (titles.length === 0) {
    return NextResponse.json({ error: "description_required" }, { status: 400 });
  }

  if (titles.some((title) => title.length > 160)) {
    return NextResponse.json({ error: "description_too_long" }, { status: 400 });
  }
  if (coinValue === null) {
    return NextResponse.json({ error: "invalid_coin_value" }, { status: 400 });
  }

  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        const familyId = await getPrimaryFamilyId(session.uid, idToken);
        if (!familyId) {
          return { kind: "family_not_found" as const };
        }
        const viewerRole = await getViewerRole(familyId, session.uid, idToken);
        if (viewerRole !== "admin" && requestedChoreType !== "see_and_do") {
          return { kind: "forbidden_action" as const };
        }
        const requesterMemberName = await getFamilyMemberName(
          familyId,
          session.memberId || session.uid,
          idToken,
          UNKNOWN_ASSIGNEE_NAME,
        );

        const [existingDocs, categories] = await Promise.all([
          listFamilyChoreDocuments(familyId, idToken),
          listFamilyCategories(familyId, idToken),
        ]);
        const categoryMap = buildCategoryMap(categories);
        if (!hasAllCategoryIds(categoryIds, categoryMap)) {
          return { kind: "invalid_category_ids" as const };
        }
        const openChores = existingDocs
          .map((doc) => normalizeChoreDoc(doc))
          .filter((doc) => !doc.deleted && doc.status === "Open")
          .sort((a, b) => compareBySortOrderOrOldest(a, b));
        const maxSortOrder = openChores.reduce((maxValue, chore) => {
          if (typeof chore.sortOrder !== "number") {
            return maxValue;
          }
          return Math.max(maxValue, chore.sortOrder);
        }, -1);
        const nextSortOrder = maxSortOrder + 1;
        const resolvedForPlayer = viewerRole !== "admin" && requestedChoreType === "see_and_do";
        const finalAssigneeScope = resolvedForPlayer ? "single" : resolvedAssigneeScope;
        const finalAssigneeIds = resolvedForPlayer ? [session.uid] : resolvedAssigneeIds;
        const finalSingleAssigneeId =
          finalAssigneeScope === "single" && finalAssigneeIds.length === 1 ? finalAssigneeIds[0] : "";
        const finalRequireApproval = resolvedForPlayer
          ? true
          : requestedChoreType === "see_and_do"
            ? true
          : finalAssigneeScope === "family" || finalAssigneeIds.length > 1
            ? true
            : requireApproval;
        const finalCoinValue = resolvedForPlayer ? 0 : coinValue;
        const finalChoreType = resolvedForPlayer
          ? "see_and_do"
          : finalAssigneeScope === "family" || finalAssigneeIds.length > 1
            ? "group"
            : requestedChoreType;
        const resolvedAssigneeName =
          finalAssigneeScope === "family"
            ? FAMILY_ASSIGNEE_NAME
            : finalAssigneeIds.length > 1
              ? `${finalAssigneeIds.length} assignees`
              : finalSingleAssigneeId
                ? resolvedForPlayer
                  ? requesterMemberName
                  : await getFamilyMemberName(familyId, finalSingleAssigneeId, idToken, UNKNOWN_ASSIGNEE_NAME)
                : UNKNOWN_ASSIGNEE_NAME;
        if (finalSingleAssigneeId) {
          const activeChoreCount = await countActiveChoresForAssignee(
            familyId,
            finalSingleAssigneeId,
            idToken,
          );
          if (activeChoreCount + titles.length > MAX_ACTIVE_CHORES_PER_ASSIGNEE) {
            return { kind: "active_chore_limit_reached" as const };
          }
        }

        const now = new Date().toISOString();
        const createdChores = titles.map((title, index) => ({
          id: randomUUID(),
          title,
          sortOrder: nextSortOrder + index,
        }));
        await Promise.all(
          createdChores.map((chore) =>
            createOrReplaceDocument(
              `families/${familyId}/chores/${chore.id}`,
              {
                title: stringField(chore.title),
                choreType: stringField(finalChoreType),
                status: stringField("Open"),
                assigneeId: stringField(finalSingleAssigneeId),
                assigneeIds: stringArrayField(finalAssigneeIds),
                assigneeScope: stringField(finalAssigneeScope),
                assigneeName: stringField(resolvedAssigneeName),
                details: stringField(details),
                categoryIds: stringArrayField(categoryIds),
                dueDate: stringField(dueDate),
                coinValue: integerField(finalCoinValue),
                requireApproval: boolField(finalRequireApproval),
                newSkillEnabled: boolField(requestedChoreType === "see_and_do" ? false : newSkillEnabled),
                recurrenceType: stringField(recurrence.recurrenceType),
                recurrenceInterval: integerField(recurrence.recurrenceInterval ?? 0),
                recurrenceUnit: stringField(recurrence.recurrenceUnit ?? ""),
                recurrenceDays: stringArrayField(recurrence.recurrenceDays ?? []),
                responsibilityPillar: stringField(responsibilityPillar),
                deleted: boolField(false),
                createdBy: stringField(session.uid),
                createdAt: timestampField(now),
                sortOrder: integerField(chore.sortOrder),
                source: stringField("manual"),
              },
              idToken,
            ),
          ),
        );
        await Promise.all(
          createdChores.map((chore) =>
            emitFamilyActivity({
              familyId,
              idToken,
              kind: "chore_created",
              actorUid: session.uid,
              actorEmail: session.email,
              actorName: session.name || session.email,
              title: "Chore added",
              message: `${session.name || "Someone"} added "${chore.title}" (${finalCoinValue} coins${finalRequireApproval ? ", approval required" : ""}${recurrence.recurrenceType !== "none" ? `, ${recurrenceLabel(recurrence).toLowerCase()}` : ""}).`,
              choreId: chore.id,
              choreTitle: chore.title,
              relatedIds: finalAssigneeIds,
            }),
          ),
        );
        await Promise.all(
          createdChores.map((chore) =>
            publishFamilyActivity({
              type: "chore_created",
              familyId,
              choreId: chore.id,
              occurredAt: now,
            }),
          ),
        );

        await Promise.all(
          titles.map(async (title) => {
            const key = usageKey(title);
            await incrementUsageCount(
              `families/${familyId}/choreUsage/${key}`,
              title,
              idToken,
            );
          }),
        );

        if (isRequesterAssignee(finalSingleAssigneeId, session.uid, session.memberId, session.email)) {
          await syncGoogleTasksForUser({
            uid: session.uid,
            idToken,
            force: true,
            minIntervalSeconds: 0,
          });
        }
        await trackAchievementEvent({
          uid: session.uid,
          familyId,
          idToken,
          viewerRole,
          eventId: `chore_create_${createdChores.map((chore) => chore.id).join("_")}`,
          metricDeltas: {
            admin_chores_created: createdChores.length,
          },
        });

        return {
          kind: "ok" as const,
          created: titles.length,
          createdChoreIds: createdChores.map((chore) => chore.id),
        };
      });

    if (data.kind === "family_not_found") {
      return NextResponse.json({ error: "family_not_found" }, { status: 404 });
    }
    if (data.kind === "forbidden_action") {
      return NextResponse.json({ error: "forbidden_action" }, { status: 403 });
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

    const response = NextResponse.json(
      { success: true, created: data.created, createdChoreIds: data.createdChoreIds },
      { status: 201 },
    );
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[CHORES_CREATE_ERROR]", reason);
    const mapped = mapCommonFirestoreErrors(reason);
    if (mapped) {
      return mapped;
    }
    return NextResponse.json({ error: "create_chores_failed" }, { status: 500 });
  }
}
