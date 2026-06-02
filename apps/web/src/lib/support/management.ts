import { adminGetDocument, adminListDocuments, adminRunQuery } from "@/lib/firestore/admin";
import {
  documentIdFromName,
  readBoolean,
  readString,
  readTimestamp,
  type FirestoreDocument,
} from "@/lib/firestore/rest";
import {
  normalizeSupportRequestStatus,
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
  createdByUid: string;
  createdByDisplayName: string;
  createdByEmail: string;
  pageUrl: string;
  createdAt: string;
  updatedAt: string;
};

export type SupportRequestDetailRecord = SupportRequestListRecord & {
  description: string;
  userAgent: string;
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

export type SupportRequestQuery = {
  type?: string;
  status?: string;
  severity?: string;
  q?: string;
  familyId?: string;
  reporter?: string;
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
  bugsBySeverity: Record<"low" | "medium" | "high", number>;
  highSeverityBugs: number;
  recentCreatedLast7Days: number;
  closedLast7Days: number;
  averageHoursToClose: number | null;
};

const MAX_QUERY_ROWS = 500;
const MAX_PAGE_SIZE = 100;
const CLOSED_STATUSES: SupportRequestStatus[] = ["done", "declined", "duplicate"];
const STATUS_SORT_ORDER: Record<SupportRequestStatus, number> = {
  new: 0,
  triaged: 1,
  planned: 2,
  in_progress: 3,
  done: 4,
  declined: 5,
  duplicate: 6,
};
const TYPE_SORT_ORDER: Record<SupportRequestType, number> = { bug: 0, feature: 1 };
const SEVERITY_SORT_ORDER: Record<SupportRequestSeverity, number> = { high: 0, medium: 1, low: 2 };

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

function buildDescriptionPreview(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed;
}

function normalizeRequest(doc: FirestoreDocument, familyNameById: Map<string, string>): SupportRequestDetailRecord {
  const familyId = familyIdFromDocumentName(doc.name);
  const type = readString(doc.fields, "type") === "feature" ? "feature" : "bug";
  const description = readString(doc.fields, "description");
  return {
    id: documentIdFromName(doc.name),
    familyId,
    familyName: familyNameById.get(familyId) ?? "",
    type,
    subject: readString(doc.fields, "subject"),
    description,
    descriptionPreview: buildDescriptionPreview(description),
    status: normalizeSupportRequestStatus(readString(doc.fields, "status")),
    severity: readSeverity(doc),
    createdByUid: readString(doc.fields, "createdByUid"),
    createdByDisplayName: readString(doc.fields, "createdByDisplayName"),
    createdByEmail: readString(doc.fields, "createdByEmail"),
    pageUrl: readString(doc.fields, "pageUrl"),
    userAgent: readString(doc.fields, "userAgent"),
    createdAt: readTimestamp(doc.fields, "createdAt"),
    updatedAt: readTimestamp(doc.fields, "updatedAt"),
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
  const familyId = query.familyId?.trim().toLowerCase() ?? "";
  const reporter = query.reporter?.trim().toLowerCase() ?? "";
  const search = query.q?.trim().toLowerCase() ?? "";
  const createdFrom = query.createdFrom?.trim() ?? "";
  const createdTo = query.createdTo?.trim() ?? "";

  return requests.filter((request) => {
    if (type && type !== "all" && request.type !== type) {
      return false;
    }
    if (status && status !== "all" && request.status !== status) {
      return false;
    }
    if (severity && severity !== "all" && request.severity !== severity) {
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
      case "status":
        return (STATUS_SORT_ORDER[a.status] - STATUS_SORT_ORDER[b.status]) * direction;
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
    triaged: 0,
    planned: 0,
    in_progress: 0,
    done: 0,
    declined: 0,
    duplicate: 0,
  };
  const byType: SupportRequestSummary["byType"] = { bug: 0, feature: 0 };
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
  const [historyDocs, auditDocs] = await Promise.all([
    adminListDocuments(`families/${familyId}/supportRequests/${supportRequestId}/history`, 200).catch(
      () => [],
    ),
    adminListDocuments(`families/${familyId}/auditLogs`, 300).catch(() => []),
  ]);

  const history = historyDocs
    .map((doc) => normalizeHistory(doc))
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  const activity = auditDocs
    .filter((doc) => readString(doc.fields, "requestId") === supportRequestId)
    .map((doc) => normalizeAudit(doc))
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));

  return { request, history, activity };
}
