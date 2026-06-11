import { adminGetDocument, adminListDocuments, adminRunQuery } from "@/lib/firestore/admin";
import {
  documentIdFromName,
  readBoolean,
  readInteger,
  readString,
  readStringArray,
  readTimestamp,
  type FirestoreDocument,
} from "@/lib/firestore/rest";
import {
  normalizeSupportRequestStatus,
  mapInternalStatusToPublicStatus,
  isPublicSupportRequestStatus,
  isSupportRequestImportance,
  type PublicSupportRequestStatus,
  type SupportRequestImportance,
  type SupportRequestSeverity,
  type SupportRequestStatus,
  type SupportRequestType,
} from "@/lib/support/requests";

export type SupportRequestListRecord = {
  id: string;
  familyId: string;
  familyName: string;
  type: SupportRequestType;
  subject: string;
  descriptionPreview: string;
  status: SupportRequestStatus;
  severity: SupportRequestSeverity | null;
  importance: SupportRequestImportance | null;
  category: string;
  createdByUid: string;
  createdByDisplayName: string;
  createdByEmail: string;
  allowContact: boolean;
  notifyOnStatusChange: boolean;
  assignedToUid: string;
  assignedToEmail: string;
  allowVoting: boolean;
  votesCount: number;
  relatedChangelogEntryId: string;
  duplicateOfId: string;
  relatedTicketIds: string[];
  pageUrl: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string;
  isPublic: boolean;
  publicTitle: string;
  publicDescription: string;
  publicStatus: PublicSupportRequestStatus;
  publicPublishedAt: string;
  publicPublishedByUid: string;
  publicUpdatedAt: string;
};

export type SupportRequestDetailRecord = SupportRequestListRecord & {
  description: string;
  userAgent: string;
  diagnostics: {
    browser: string;
    operatingSystem: string;
    screenResolution: string;
    language: string;
    appVersion: string;
    recentConsoleErrors: string;
    recentApiFailures: string;
  };
};

export type SupportRequestHistoryRecord = {
  id: string;
  action: string;
  previousStatus: string;
  nextStatus: string;
  note: string;
  changedByUid: string;
  changedByEmail: string;
  createdAt: string;
};

export type SupportRequestAuditRecord = {
  id: string;
  eventType: string;
  source: string;
  reason: string;
  actorUid: string;
  actorEmail: string;
  actorName: string;
  createdAt: string;
  previousStatus: string;
  nextStatus: string;
};

// Internal-only operator note (Phase 10). Never exposed to end users.
export type SupportRequestNoteRecord = {
  id: string;
  body: string;
  authorUid: string;
  authorEmail: string;
  authorName: string;
  createdAt: string;
};

export type SupportRequestQuery = {
  type?: string;
  status?: string;
  severity?: string;
  importance?: string;
  category?: string;
  q?: string;
  familyId?: string;
  reporter?: string;
  assignee?: string;
  createdFrom?: string;
  createdTo?: string;
  sortBy?: string;
  sortDir?: string;
  page?: number;
  limit?: number;
};

export type SupportRequestSummary = {
  total: number;
  byStatus: Record<SupportRequestStatus, number>;
  byType: Record<SupportRequestType, number>;
  openByType: Record<SupportRequestType, number>;
  bugsBySeverity: Record<"low" | "medium" | "high", number>;
  highSeverityBugs: number;
  recentCreatedLast7Days: number;
  closedLast7Days: number;
  averageHoursToClose: number | null;
};

const MAX_QUERY_ROWS = 500;
const MAX_PAGE_SIZE = 100;
const CLOSED_STATUSES: SupportRequestStatus[] = [
  "released",
  "done",
  "closed",
  "declined",
  "duplicate",
  "cancelled",
];
const STATUS_SORT_ORDER: Record<SupportRequestStatus, number> = {
  new: 0,
  needs_info: 1,
  triaged: 2,
  planned: 3,
  in_progress: 4,
  released: 5,
  done: 6,
  closed: 7,
  declined: 8,
  duplicate: 9,
  cancelled: 10,
};
const TYPE_SORT_ORDER: Record<SupportRequestType, number> = {
  bug: 0,
  feature: 1,
  question: 2,
  feedback: 3,
};
const SEVERITY_SORT_ORDER: Record<SupportRequestSeverity, number> = { high: 0, medium: 1, low: 2 };
const IMPORTANCE_SORT_ORDER: Record<SupportRequestImportance, number> = {
  blocking: 0,
  very_important: 1,
  useful: 2,
  nice_to_have: 3,
};

function getPrioritySortOrder(record: SupportRequestListRecord) {
  if (record.severity) {
    return SEVERITY_SORT_ORDER[record.severity] ?? 99;
  }
  if (record.importance) {
    return IMPORTANCE_SORT_ORDER[record.importance] ?? 99;
  }
  return 99;
}

function getReporterSortValue(record: SupportRequestListRecord) {
  return (
    record.createdByDisplayName.trim() ||
    record.createdByEmail.trim() ||
    record.createdByUid.trim()
  ).toLowerCase();
}

function familyIdFromDocumentName(name: string) {
  const match = name.match(/\/families\/([^/]+)\/supportRequests\//);
  return match?.[1] ?? "";
}

function readSeverity(doc: FirestoreDocument) {
  const raw = readString(doc.fields, "severity");
  return raw === "low" || raw === "medium" || raw === "high"
    ? (raw as SupportRequestSeverity)
    : null;
}

function readImportance(doc: FirestoreDocument): SupportRequestImportance | null {
  const raw = readString(doc.fields, "importance");
  return isSupportRequestImportance(raw) ? raw : null;
}

// Tolerant type read: anything outside the known set falls back to "bug" so a
// malformed legacy doc still renders somewhere in the console.
function readType(doc: FirestoreDocument): SupportRequestType {
  const raw = readString(doc.fields, "type");
  return raw === "feature" || raw === "question" || raw === "feedback" ? raw : "bug";
}

function buildDescriptionPreview(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed;
}

function normalizeRequest(doc: FirestoreDocument, familyNameById: Map<string, string>): SupportRequestDetailRecord {
  const familyId = familyIdFromDocumentName(doc.name);
  const type = readType(doc);
  const description = readString(doc.fields, "description");
  const storedStatus = normalizeSupportRequestStatus(readString(doc.fields, "status"));
  // A reporter-cancelled request keeps its document for record-keeping. Newer
  // cancels write status "cancelled" directly; older ones only set the
  // `cancelledByUser` flag and left status as "new". Surface both as
  // "cancelled" here so the console never shows a cancelled request as New.
  // Once an operator moves it off "new" (e.g. to re-triage), respect that.
  const status: SupportRequestStatus =
    readBoolean(doc.fields, "cancelledByUser") && storedStatus === "new"
      ? "cancelled"
      : storedStatus;
  const publicStatus = readString(doc.fields, "publicStatus");
  return {
    id: documentIdFromName(doc.name),
    familyId,
    familyName: familyNameById.get(familyId) ?? "",
    type,
    subject: readString(doc.fields, "subject"),
    description,
    descriptionPreview: buildDescriptionPreview(description),
    status,
    severity: readSeverity(doc),
    importance: readImportance(doc),
    category: readString(doc.fields, "category"),
    createdByUid: readString(doc.fields, "createdByUid"),
    createdByDisplayName: readString(doc.fields, "createdByDisplayName"),
    createdByEmail: readString(doc.fields, "createdByEmail"),
    allowContact: readBoolean(doc.fields, "allowContact"),
    notifyOnStatusChange: readBoolean(doc.fields, "notifyOnStatusChange"),
    assignedToUid: readString(doc.fields, "assignedToUid"),
    assignedToEmail: readString(doc.fields, "assignedToEmail"),
    allowVoting: readBoolean(doc.fields, "allowVoting"),
    votesCount: readInteger(doc.fields, "votesCount"),
    relatedChangelogEntryId: readString(doc.fields, "relatedChangelogEntryId"),
    duplicateOfId: readString(doc.fields, "duplicateOfId"),
    relatedTicketIds: readStringArray(doc.fields, "relatedTicketIds"),
    pageUrl: readString(doc.fields, "pageUrl"),
    userAgent: readString(doc.fields, "userAgent"),
    diagnostics: {
      browser: readString(doc.fields, "diagBrowser"),
      operatingSystem: readString(doc.fields, "diagOperatingSystem"),
      screenResolution: readString(doc.fields, "diagScreenResolution"),
      language: readString(doc.fields, "diagLanguage"),
      appVersion: readString(doc.fields, "diagAppVersion"),
      recentConsoleErrors: readString(doc.fields, "diagRecentConsoleErrors"),
      recentApiFailures: readString(doc.fields, "diagRecentApiFailures"),
    },
    createdAt: readTimestamp(doc.fields, "createdAt"),
    updatedAt: readTimestamp(doc.fields, "updatedAt"),
    closedAt: readTimestamp(doc.fields, "closedAt"),
    isPublic: readBoolean(doc.fields, "isPublic"),
    publicTitle: readString(doc.fields, "publicTitle"),
    publicDescription: readString(doc.fields, "publicDescription"),
    publicStatus: isPublicSupportRequestStatus(publicStatus)
      ? publicStatus
      : mapInternalStatusToPublicStatus(status),
    publicPublishedAt: readTimestamp(doc.fields, "publicPublishedAt"),
    publicPublishedByUid: readString(doc.fields, "publicPublishedByUid"),
    publicUpdatedAt: readTimestamp(doc.fields, "publicUpdatedAt"),
  };
}

function normalizeHistory(doc: FirestoreDocument): SupportRequestHistoryRecord {
  return {
    id: documentIdFromName(doc.name),
    action: readString(doc.fields, "action"),
    previousStatus: readString(doc.fields, "previousStatus"),
    nextStatus: readString(doc.fields, "nextStatus"),
    note: readString(doc.fields, "note"),
    changedByUid: readString(doc.fields, "changedByUid"),
    changedByEmail: readString(doc.fields, "changedByEmail"),
    createdAt: readTimestamp(doc.fields, "createdAt"),
  };
}

function normalizeNote(doc: FirestoreDocument): SupportRequestNoteRecord {
  return {
    id: documentIdFromName(doc.name),
    body: readString(doc.fields, "body"),
    authorUid: readString(doc.fields, "authorUid"),
    authorEmail: readString(doc.fields, "authorEmail"),
    authorName: readString(doc.fields, "authorName"),
    createdAt: readTimestamp(doc.fields, "createdAt"),
  };
}

function normalizeAudit(doc: FirestoreDocument): SupportRequestAuditRecord {
  const previousStatus = readString(doc.fields, "previousStatus");
  const nextStatus = readString(doc.fields, "nextStatus");
  return {
    id: documentIdFromName(doc.name),
    eventType: readString(doc.fields, "eventType"),
    source: readString(doc.fields, "source"),
    reason: readString(doc.fields, "reason"),
    actorUid: readString(doc.fields, "actorUid"),
    actorEmail: readString(doc.fields, "actorEmail"),
    actorName: readString(doc.fields, "actorName"),
    createdAt: readTimestamp(doc.fields, "createdAt"),
    previousStatus,
    nextStatus,
  };
}

function matchesDateRange(value: string, createdFrom: string, createdTo: string) {
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) {
    return false;
  }
  if (createdFrom) {
    const fromMillis = Date.parse(`${createdFrom}T00:00:00.000Z`);
    if (Number.isFinite(fromMillis) && millis < fromMillis) {
      return false;
    }
  }
  if (createdTo) {
    const toMillis = Date.parse(`${createdTo}T23:59:59.999Z`);
    if (Number.isFinite(toMillis) && millis > toMillis) {
      return false;
    }
  }
  return true;
}

function compareStrings(a: string, b: string, direction: number) {
  return a.localeCompare(b) * direction;
}

function compareDates(a: string, b: string, direction: number) {
  return ((Date.parse(a) || 0) - (Date.parse(b) || 0)) * direction;
}

export function filterSupportRequests(
  requests: SupportRequestListRecord[],
  query: SupportRequestQuery,
) {
  const type = query.type?.trim();
  const status = query.status?.trim();
  const severity = query.severity?.trim();
  const importance = query.importance?.trim();
  const category = query.category?.trim();
  const familyId = query.familyId?.trim().toLowerCase() ?? "";
  const reporter = query.reporter?.trim().toLowerCase() ?? "";
  const assignee = query.assignee?.trim().toLowerCase() ?? "";
  const search = query.q?.trim().toLowerCase() ?? "";
  const createdFrom = query.createdFrom?.trim() ?? "";
  const createdTo = query.createdTo?.trim() ?? "";

  return requests.filter((request) => {
    if (type && type !== "all" && request.type !== type) {
      return false;
    }
    if (status && status !== "all") {
      if (status === "open") {
        if (CLOSED_STATUSES.includes(request.status)) {
          return false;
        }
      } else if (request.status !== status) {
        return false;
      }
    }
    if (severity && severity !== "all" && request.severity !== severity) {
      return false;
    }
    if (importance && importance !== "all" && request.importance !== importance) {
      return false;
    }
    if (category && category !== "all" && request.category !== category) {
      return false;
    }
    if (familyId && !request.familyId.toLowerCase().includes(familyId)) {
      return false;
    }
    if (
      reporter &&
      ![
        request.createdByUid,
        request.createdByEmail,
        request.createdByDisplayName,
      ].some((value) => value.toLowerCase().includes(reporter))
    ) {
      return false;
    }
    if (assignee && assignee !== "all") {
      if (assignee === "unassigned") {
        if (request.assignedToUid) {
          return false;
        }
      } else if (
        ![request.assignedToUid, request.assignedToEmail].some((value) =>
          value.toLowerCase().includes(assignee),
        )
      ) {
        return false;
      }
    }
    if (search) {
      const haystack = [
        request.subject,
        request.descriptionPreview,
        request.familyName,
        request.familyId,
        request.createdByEmail,
        request.createdByDisplayName,
        request.pageUrl,
      ]
        .join("\n")
        .toLowerCase();
      if (!haystack.includes(search)) {
        return false;
      }
    }
    if ((createdFrom || createdTo) && !matchesDateRange(request.createdAt, createdFrom, createdTo)) {
      return false;
    }
    return true;
  });
}

export function sortSupportRequests(requests: SupportRequestListRecord[], query: SupportRequestQuery) {
  const sortBy = query.sortBy?.trim() ?? "updatedAt";
  const direction = query.sortDir === "asc" ? 1 : -1;

  return [...requests].sort((a, b) => {
    switch (sortBy) {
      case "createdAt":
        return compareDates(a.createdAt, b.createdAt, direction);
      case "updatedAt":
        return compareDates(a.updatedAt || a.createdAt, b.updatedAt || b.createdAt, direction);
      case "severity":
        return ((SEVERITY_SORT_ORDER[a.severity ?? "low"] ?? 99) -
          (SEVERITY_SORT_ORDER[b.severity ?? "low"] ?? 99)) * direction;
      case "importance":
        return ((a.importance ? IMPORTANCE_SORT_ORDER[a.importance] : 99) -
          (b.importance ? IMPORTANCE_SORT_ORDER[b.importance] : 99)) * direction;
      case "priority":
        return (getPrioritySortOrder(a) - getPrioritySortOrder(b)) * direction;
      case "status":
        return (STATUS_SORT_ORDER[a.status] - STATUS_SORT_ORDER[b.status]) * direction;
      case "reporter":
        return compareStrings(getReporterSortValue(a), getReporterSortValue(b), direction);
      case "type":
        return (TYPE_SORT_ORDER[a.type] - TYPE_SORT_ORDER[b.type]) * direction;
      default:
        return compareDates(a.updatedAt || a.createdAt, b.updatedAt || b.createdAt, -1);
    }
  });
}

export function paginateSupportRequests(requests: SupportRequestListRecord[], query: SupportRequestQuery) {
  const pageSize = Math.min(Math.max(1, query.limit ?? 25), MAX_PAGE_SIZE);
  const total = requests.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, query.page ?? 1), totalPages);
  const start = (page - 1) * pageSize;
  return {
    records: requests.slice(start, start + pageSize),
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
    },
  };
}

export function summarizeSupportRequests(requests: SupportRequestListRecord[]): SupportRequestSummary {
  const byStatus: SupportRequestSummary["byStatus"] = {
    new: 0,
    needs_info: 0,
    triaged: 0,
    planned: 0,
    in_progress: 0,
    released: 0,
    done: 0,
    closed: 0,
    declined: 0,
    duplicate: 0,
    cancelled: 0,
  };
  const byType: SupportRequestSummary["byType"] = { bug: 0, feature: 0, question: 0, feedback: 0 };
  const openByType: SupportRequestSummary["openByType"] = { bug: 0, feature: 0, question: 0, feedback: 0 };
  const bugsBySeverity: SupportRequestSummary["bugsBySeverity"] = { low: 0, medium: 0, high: 0 };
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  let highSeverityBugs = 0;
  let recentCreatedLast7Days = 0;
  let closedLast7Days = 0;
  let closeSampleCount = 0;
  let closeHoursTotal = 0;

  for (const request of requests) {
    byStatus[request.status] += 1;
    byType[request.type] += 1;
    if (!CLOSED_STATUSES.includes(request.status)) {
      openByType[request.type] += 1;
    }
    if (request.type === "bug" && request.severity) {
      bugsBySeverity[request.severity] += 1;
      if (request.severity === "high") {
        highSeverityBugs += 1;
      }
    }

    const createdMillis = Date.parse(request.createdAt);
    const updatedMillis = Date.parse(request.updatedAt || request.createdAt);
    if (Number.isFinite(createdMillis) && createdMillis >= sevenDaysAgo) {
      recentCreatedLast7Days += 1;
    }
    if (CLOSED_STATUSES.includes(request.status) && Number.isFinite(updatedMillis)) {
      if (updatedMillis >= sevenDaysAgo) {
        closedLast7Days += 1;
      }
      if (Number.isFinite(createdMillis) && updatedMillis >= createdMillis) {
        closeSampleCount += 1;
        closeHoursTotal += (updatedMillis - createdMillis) / (1000 * 60 * 60);
      }
    }
  }

  return {
    total: requests.length,
    byStatus,
    byType,
    openByType,
    bugsBySeverity,
    highSeverityBugs,
    recentCreatedLast7Days,
    closedLast7Days,
    averageHoursToClose:
      closeSampleCount > 0 ? Number((closeHoursTotal / closeSampleCount).toFixed(1)) : null,
  };
}

export async function loadAllSupportRequests() {
  const [requestDocs, familyDocs] = await Promise.all([
    adminRunQuery({
      from: [{ collectionId: "supportRequests", allDescendants: true }],
      limit: MAX_QUERY_ROWS,
    }),
    adminListDocuments("families", MAX_QUERY_ROWS),
  ]);

  const familyNameById = new Map<string, string>();
  for (const doc of familyDocs) {
    familyNameById.set(documentIdFromName(doc.name), readString(doc.fields, "name") || "Family");
  }

  return requestDocs
    .filter((doc) => !readBoolean(doc.fields, "deleted"))
    .map((doc) => normalizeRequest(doc, familyNameById));
}

export async function loadSupportRequestDetail(familyId: string, supportRequestId: string) {
  const familyDocPromise = adminGetDocument(`families/${familyId}`).catch(() => null);
  const requestDoc = await adminGetDocument(`families/${familyId}/supportRequests/${supportRequestId}`);
  if (readBoolean(requestDoc.fields, "deleted")) {
    throw new Error("SUPPORT_REQUEST_DELETED");
  }
  const familyDoc = await familyDocPromise;
  const familyNameById = new Map<string, string>([
    [familyId, familyDoc ? readString(familyDoc.fields, "name") || "Family" : "Family"],
  ]);
  const request = normalizeRequest(requestDoc, familyNameById);
  const [historyDocs, auditDocs, noteDocs] = await Promise.all([
    adminListDocuments(`families/${familyId}/supportRequests/${supportRequestId}/history`, 200).catch(
      () => [],
    ),
    adminListDocuments(`families/${familyId}/auditLogs`, 300).catch(() => []),
    adminListDocuments(`families/${familyId}/supportRequests/${supportRequestId}/internalNotes`, 200).catch(
      () => [],
    ),
  ]);

  const history = historyDocs
    .map((doc) => normalizeHistory(doc))
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  const activity = auditDocs
    .filter((doc) => readString(doc.fields, "requestId") === supportRequestId)
    .map((doc) => normalizeAudit(doc))
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  const notes = noteDocs
    .map((doc) => normalizeNote(doc))
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));

  return { request, history, activity, notes };
}
