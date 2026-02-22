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
  readBoolean,
  readInteger,
  readString,
  readStringArray,
  readTimestamp,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import { emitFamilyActivity } from "@/lib/notifications/events";
import { publishFamilyActivity } from "@/lib/ws/publish-family-activity";

type CreateChoresBody = {
  description?: unknown;
  assigneeId?: unknown;
  details?: unknown;
  titles?: unknown;
  dueDate?: unknown;
};

type ChoreRow = {
  id: string;
  title: string;
  status: string;
  assigneeId?: string;
  assigneeName: string;
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
  | "title"
  | "status"
  | "assigneeName"
  | "dueDate"
  | "completedAt"
  | "coinValue";

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

function asDateOrToday(value: unknown) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  return new Date().toISOString().slice(0, 10);
}

function normalizeDescription(value: string) {
  return value.trim().replace(/\s+/g, " ");
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
  return {
    id: documentIdFromName(doc.name),
    title: readString(doc.fields, "title") || "Untitled chore",
    status: readString(doc.fields, "status") || "Open",
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
    if (status === "Deleted") {
      return false;
    }
    return readString(doc.fields, "assigneeId") === assigneeId;
  }).length;
}

function parseSortBy(value: string | null): ChoreSortBy {
  if (
    value === "title" ||
    value === "status" ||
    value === "assigneeName" ||
    value === "dueDate" ||
    value === "completedAt" ||
    value === "coinValue"
  ) {
    return value;
  }
  return "dueDate";
}

function parseSortDir(value: string | null) {
  return value === "desc" ? "desc" : "asc";
}

function normalizeSearch(value: string | null) {
  return (value ?? "").trim().toLowerCase();
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

function sortChores(rows: ChoreRow[], sortBy: ChoreSortBy, sortDir: "asc" | "desc") {
  const direction = sortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const valueA =
      sortBy === "title"
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
      sortBy === "title"
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
    const compared = compareValues(valueA, valueB);
    if (compared !== 0) {
      return compared * direction;
    }
    return (toUnixMillis(b.createdAt) - toUnixMillis(a.createdAt)) * direction;
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

  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        let familyId = "";
        try {
          familyId = await getPrimaryFamilyId(session.uid, idToken);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "";
          if (
            reason.includes("FIRESTORE_HTTP_404") &&
            reason.toLowerCase().includes("document") &&
            reason.toLowerCase().includes("not found")
          ) {
            return { chores: [] as ChoreRow[], viewerRole: "player" as ViewerRole };
          }
          throw error;
        }

        if (!familyId) {
          return { chores: [] as ChoreRow[], viewerRole: "player" as ViewerRole };
        }
        const viewerRole = await getViewerRole(familyId, session.uid, idToken);

        const docs = await listDocuments(`families/${familyId}/chores`, idToken, 500);
        const filteredChores = docs
          .map((doc) => normalizeChoreDoc(doc))
          .filter((doc) => !doc.deleted)
          .filter((doc) => choreMatchesQuery(doc, query));
        const chores = sortChores(filteredChores, sortBy, sortDir)
          .map((doc) => ({
            id: doc.id,
            title: doc.title,
            status: doc.status,
            assigneeId: doc.assigneeId,
            assigneeName: doc.assigneeName,
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
        const createdChores = titles.map((title) => ({
          id: randomUUID(),
          title,
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
