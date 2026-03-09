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
  readBoolean,
  readInteger,
  readString,
  readStringArray,
  readTimestamp,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import { emitFamilyActivity } from "@/lib/notifications/events";
import { parseCompletionWindow, type CompletionWindow } from "@/lib/preferences/completion-window";
import { publishFamilyActivity } from "@/lib/ws/publish-family-activity";
import { createFamilySocketAuthToken } from "@/lib/ws/family-auth-token";
import { GOOGLE_TASKS_CHORE_SOURCE, syncGoogleTasksForUser } from "@/lib/google/tasks-sync";

type CreateChoresBody = {
  description?: unknown;
  assigneeId?: unknown;
  details?: unknown;
  titles?: unknown;
  dueDate?: unknown;
};

type ReorderChoresBody = {
  action?: unknown;
  orderedChoreIds?: unknown;
};

type ChoreRow = {
  id: string;
  title: string;
  status: string;
  source: "manual" | "google_tasks";
  sortOrder?: number;
  assigneeId?: string;
  assigneeName: string;
  assigneeAvatarId?: string;
  assigneeAvatarPhotoUrl?: string;
  details?: string;
  dueDate: string;
  completedAt?: string;
  coinValue: number;
  deleted: boolean;
  createdAt?: string;
  submittedAt?: string;
  updatedAt?: string;
};

type ViewerRole = "admin" | "player";
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;
const MAX_ACTIVE_CHORES_PER_ASSIGNEE = 100;
type ChoreSortBy =
  | "sortOrder"
  | "title"
  | "status"
  | "assigneeName"
  | "dueDate"
  | "completedAt"
  | "coinValue";
type ChoreStatusFilter = "" | "completed";
type CompletionWindowRange = {
  startMillis: number;
  endMillis: number;
};
const MINUTE_MILLIS = 60 * 1000;
const MAX_TIMEZONE_OFFSET_MINUTES = 14 * 60;

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

function toUnixMillis(value?: string) {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
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

function asDateOrToday(value: unknown) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  return new Date().toISOString().slice(0, 10);
}

function normalizeDescription(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
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

async function getPrimaryFamilyId(uid: string, idToken: string) {
  const userDoc = await getDocument(`users/${uid}`, idToken);
  return readStringArray(userDoc.fields, "familyIds")[0] ?? "";
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

async function incrementUsageCount(
  path: string,
  description: string,
  idToken: string,
  usageField: "familyCount" | "globalCount",
) {
  let currentCount = 0;
  try {
    const doc = await getDocument(path, idToken);
    currentCount = readInteger(doc.fields, usageField);
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
      [usageField]: integerField(currentCount + 1),
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
  return {
    id: documentIdFromName(doc.name),
    title,
    status: readString(doc.fields, "status") || "Open",
    source,
    sortOrder: readOptionalSortOrder(doc.fields),
    assigneeId: readString(doc.fields, "assigneeId") || undefined,
    assigneeName: readString(doc.fields, "assigneeName") || "Unassigned",
    details: readString(doc.fields, "details") || undefined,
    dueDate: readString(doc.fields, "dueDate"),
    submittedAt: readTimestamp(doc.fields, "submittedAt") || undefined,
    updatedAt: readTimestamp(doc.fields, "updatedAt") || undefined,
    coinValue: readInteger(doc.fields, "coinValue") || 10,
    deleted: readBoolean(doc.fields, "deleted"),
    createdAt: readTimestamp(doc.fields, "createdAt") || undefined,
  };
}

function mapCommonFirestoreErrors(reason: string) {
  if (reason.includes("FIRESTORE_HTTP_401")) {
    return jsonReauthRequired();
  }
  if (reason.includes("FIREBASE_REFRESH_FAILED")) {
    return jsonReauthRequired();
  }
  if (reason.includes("FIRESTORE_HTTP_403")) {
    return jsonFirestoreForbidden();
  }
  return null;
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

async function countActiveChoresForAssignee(
  familyId: string,
  assigneeId: string,
  idToken: string,
) {
  if (!assigneeId) {
    return 0;
  }
  const docs = await listDocuments(`families/${familyId}/chores`, idToken, 1000);
  return docs.filter((doc) => {
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
  return value === "completed" ? "completed" : "";
}

function parseAssigneeFilter(value: string | null) {
  return (value ?? "").trim();
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

function isFutureDueDate(value: string, todayIsoDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  return value > todayIsoDate;
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
  const haystack = [
    doc.title,
    doc.status,
    doc.assigneeName,
    doc.details ?? "",
    doc.dueDate,
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
  const assigneeFilter = parseAssigneeFilter(request.nextUrl.searchParams.get("assigneeId"));
  const statusFilter = parseStatusFilter(request.nextUrl.searchParams.get("status"));
  const completionWindow = parseCompletionWindow(request.nextUrl.searchParams.get("completedWindow"));
  const timezoneOffsetMinutes = parseTimezoneOffsetMinutes(
    request.nextUrl.searchParams.get("tzOffsetMinutes"),
  );
  const completionWindowRange = completionWindow
    ? getCompletionWindowRange(completionWindow, timezoneOffsetMinutes)
    : null;
  const todayIsoDate = new Date().toISOString().slice(0, 10);

  try {
    const { data, session: refreshedSession, refreshed } =
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
        await syncGoogleTasksForUser({
          uid: session.uid,
          idToken,
          minIntervalSeconds: 60,
        });
        const viewerRole = await getViewerRole(familyId, session.uid, idToken);

        const [memberDocs, docs] = await Promise.all([
          listDocuments(`families/${familyId}/members`, idToken, 200),
          listDocuments(`families/${familyId}/chores`, idToken, 500),
        ]);
        const assigneeAliasToMemberId = buildAssigneeAliasToMemberId(memberDocs);
        const viewerAssigneeAliases = buildViewerAssigneeAliases(memberDocs, session.uid, session.email);
        const targetAssigneeId = assigneeFilter
          ? assigneeAliasToMemberId.get(assigneeFilter) ??
            assigneeAliasToMemberId.get(normalizeEmail(assigneeFilter)) ??
            assigneeFilter
          : "";
        const assigneeAvatarByAlias = new Map<string, string>();
        const assigneeAvatarPhotoByAlias = new Map<string, string>();
        for (const memberDoc of memberDocs) {
          if (readBoolean(memberDoc.fields, "deleted")) {
            continue;
          }
          const memberId = documentIdFromName(memberDoc.name);
          const avatarId = readString(memberDoc.fields, "avatarId");
          const avatarPhotoUrl = readString(memberDoc.fields, "avatarPhotoUrl");
          if (avatarId) {
            assigneeAvatarByAlias.set(memberId, avatarId);
          }
          if (avatarPhotoUrl) {
            assigneeAvatarPhotoByAlias.set(memberId, avatarPhotoUrl);
          }
          const memberUid = readString(memberDoc.fields, "uid");
          if (memberUid) {
            if (avatarId) {
              assigneeAvatarByAlias.set(memberUid, avatarId);
            }
            if (avatarPhotoUrl) {
              assigneeAvatarPhotoByAlias.set(memberUid, avatarPhotoUrl);
            }
          }
          const normalizedEmail = normalizeEmail(readString(memberDoc.fields, "email"));
          if (normalizedEmail) {
            if (avatarId) {
              assigneeAvatarByAlias.set(normalizedEmail, avatarId);
            }
            if (avatarPhotoUrl) {
              assigneeAvatarPhotoByAlias.set(normalizedEmail, avatarPhotoUrl);
            }
          }
        }
        const filteredChores = docs
          .map((doc) => normalizeChoreDoc(doc))
          .filter((doc) => !doc.deleted)
          .filter((doc) => {
            if (isCompletedStatus(doc.status)) {
              return true;
            }
            return !isFutureDueDate(doc.dueDate, todayIsoDate);
          })
          .filter((doc) => {
            if (statusFilter !== "completed") {
              return true;
            }
            return isCompletedStatus(doc.status);
          })
          .filter((doc) => {
            if (!targetAssigneeId) {
              return true;
            }
            const assigneeId = doc.assigneeId ?? "";
            if (!assigneeId) {
              return false;
            }
            const canonicalAssigneeId =
              assigneeAliasToMemberId.get(assigneeId) ??
              assigneeAliasToMemberId.get(normalizeEmail(assigneeId)) ??
              assigneeId;
            return canonicalAssigneeId === targetAssigneeId;
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
            status: doc.status,
            source: doc.source,
            sortOrder: doc.sortOrder,
            assigneeId: doc.assigneeId,
            assigneeName: doc.assigneeName,
            assigneeAvatarId: doc.assigneeId
              ? assigneeAvatarByAlias.get(doc.assigneeId) ??
                assigneeAvatarByAlias.get(normalizeEmail(doc.assigneeId))
              : undefined,
            assigneeAvatarPhotoUrl: doc.assigneeId
              ? assigneeAvatarPhotoByAlias.get(doc.assigneeId) ??
                assigneeAvatarPhotoByAlias.get(normalizeEmail(doc.assigneeId))
              : undefined,
            details: doc.details,
            dueDate: doc.dueDate,
            completedAt:
              doc.status === "Submitted" || doc.status === "Approved"
                ? doc.submittedAt || doc.updatedAt || undefined
                : undefined,
            coinValue: doc.coinValue,
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
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[CHORES_LIST_ERROR]", reason);
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

        const docs = await listDocuments(`families/${familyId}/chores`, idToken, 1000);
        const openChores = docs
          .map((doc) => normalizeChoreDoc(doc))
          .filter((doc) => !doc.deleted && doc.status === "Open")
          .sort((a, b) => compareBySortOrderOrOldest(a, b));
        if (openChores.length === 0) {
          return { kind: "ok" as const, updatedCount: 0 };
        }

        const openById = new Map(openChores.map((chore) => [chore.id, chore] as const));
        for (const choreId of orderedChoreIds) {
          if (!openById.has(choreId)) {
            return { kind: "invalid_ordered_chore_ids" as const };
          }
        }
        const openIds = new Set(openChores.map((chore) => chore.id));
        if (orderedChoreIds.length !== openIds.size) {
          return { kind: "invalid_ordered_chore_ids" as const };
        }

        const now = new Date().toISOString();
        const changedOpenChores = orderedChoreIds
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

        const existingDocs = await listDocuments(`families/${familyId}/chores`, idToken, 1000);
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
        const resolvedAssigneeName = assigneeId
          ? await getFamilyMemberName(familyId, assigneeId, idToken)
          : "Unassigned";
        if (assigneeId) {
          const activeChoreCount = await countActiveChoresForAssignee(
            familyId,
            assigneeId,
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
                status: stringField("Open"),
                assigneeId: stringField(assigneeId),
                assigneeName: stringField(resolvedAssigneeName),
                details: stringField(details),
                dueDate: stringField(dueDate),
                coinValue: integerField(10),
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
              message: `${session.name || "Someone"} added "${chore.title}".`,
              choreId: chore.id,
              choreTitle: chore.title,
              relatedIds: assigneeId ? [assigneeId] : [],
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
              "familyCount",
            );
            await incrementUsageCount(
              `choreUsageGlobal/${key}`,
              title,
              idToken,
              "globalCount",
            );
          }),
        );

        return { kind: "ok" as const, created: titles.length };
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

    const response = NextResponse.json({ success: true, created: data.created }, { status: 201 });
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



