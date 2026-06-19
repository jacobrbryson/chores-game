import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  createOrReplaceDocument,
  documentIdFromName,
  getDocument,
  listDocuments,
  runQuery,
  readBoolean,
  readString,
  readStringArray,
  readTimestamp,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import { recordOperationMetric } from "@/lib/observability/metrics";

type MarkSeenBody = {
  ids?: unknown;
};

type RequesterContext = {
  role: "admin" | "player";
  aliases: Set<string>;
};

type NotificationsPatchDebugContext = {
  sessionUid: string;
  sessionEmail: string;
  authUid: string;
  authEmail: string;
  familyId: string;
  requesterRole: "admin" | "player";
  requesterAliases: string[];
  requestedIds: string[];
  visibleIds: string[];
};

type NotificationItem = {
  id: string;
  kind: string;
  title: string;
  message: string;
  createdAt: string;
  seen: boolean;
  triggeredByViewer: boolean;
};
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;
// Notifications grow without bound, so we read the most-recent window via an
// ordered query (single-field index on createdAt) instead of an arbitrary
// unordered page. Search, sort, and the unseen badge operate over this window.
const RECENT_NOTIFICATION_LIMIT = 500;
// A single viewer's seen markers, scoped by uid (equality, single-field index).
const VIEWER_SEEN_MARKER_LIMIT = 5000;
type NotificationSortBy = "createdAt" | "title" | "message" | "seen" | "kind";

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

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function parseBooleanParam(value: string | null) {
  if (!value) {
    return false;
  }
  return value === "true" || value === "1";
}

function toRole(value: string) {
  return value === "admin" ? "admin" : "player";
}

function toUnixMillis(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

async function getPrimaryFamilyId(uid: string, idToken: string) {
  let userDoc: Awaited<ReturnType<typeof getDocument>>;
  try {
    userDoc = await getDocument(`users/${uid}`, idToken);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_HTTP_404")) {
      return "";
    }
    throw error;
  }
  return readStringArray(userDoc.fields, "familyIds")[0] ?? "";
}

async function getRequesterContext(
  familyId: string,
  uid: string,
  email: string,
  idToken: string,
): Promise<RequesterContext> {
  const aliases = new Set<string>([normalize(uid)]);
  const normalizedEmail = normalize(email);
  if (normalizedEmail) {
    aliases.add(normalizedEmail);
  }
  let role: "admin" | "player" = "player";
  let roleResolved = false;

  async function mergeMemberDoc(memberDocId: string) {
    if (!memberDocId) {
      return;
    }
    try {
      const doc = await getDocument(`families/${familyId}/members/${memberDocId}`, idToken);
      if (readBoolean(doc.fields, "deleted")) {
        return;
      }
      aliases.add(normalize(memberDocId));
      const memberUid = normalize(readString(doc.fields, "uid"));
      const memberEmail = normalize(readString(doc.fields, "email"));
      if (memberUid) {
        aliases.add(memberUid);
      }
      if (memberEmail) {
        aliases.add(memberEmail);
      }
      if (!roleResolved) {
        role = toRole(readString(doc.fields, "role"));
        roleResolved = true;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      if (!reason.includes("FIRESTORE_HTTP_404")) {
        throw error;
      }
    }
  }

  await mergeMemberDoc(uid);
  if (normalizedEmail && normalizedEmail !== normalize(uid)) {
    await mergeMemberDoc(normalizedEmail);
  }

  if (!roleResolved) {
    const memberDocs = await listDocuments(`families/${familyId}/members`, idToken, 200);
    for (const doc of memberDocs) {
      if (readBoolean(doc.fields, "deleted")) {
        continue;
      }
      const memberId = normalize(documentIdFromName(doc.name));
      const memberUid = normalize(readString(doc.fields, "uid"));
      const memberEmail = normalize(readString(doc.fields, "email"));
      const uidMatch = memberUid === normalize(uid);
      const emailMatch = normalizedEmail && memberEmail === normalizedEmail;
      if (!uidMatch && !emailMatch) {
        continue;
      }
      if (memberId) {
        aliases.add(memberId);
      }
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

  return { role, aliases };
}

function isVisibleToPlayer(relatedIds: string[], aliases: Set<string>) {
  if (relatedIds.length === 0) {
    return false;
  }
  return relatedIds.some((entry) => aliases.has(normalize(entry)));
}

function mapCommonFirestoreErrors(reason: string, fallbackError: string) {
  if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
    return jsonReauthRequired();
  }
  if (reason.includes("FIRESTORE_HTTP_403")) {
    return jsonFirestoreForbidden();
  }
  return NextResponse.json({ error: fallbackError }, { status: 500 });
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

function parseSortBy(value: string | null): NotificationSortBy {
  if (
    value === "createdAt" ||
    value === "title" ||
    value === "message" ||
    value === "seen" ||
    value === "kind"
  ) {
    return value;
  }
  return "createdAt";
}

function parseSortDir(value: string | null) {
  return value === "asc" ? "asc" : "desc";
}

function normalizeSearch(value: string | null) {
  return (value ?? "").trim().toLowerCase();
}

function matchesSearch(item: NotificationItem, query: string) {
  if (query.length < 3) {
    return true;
  }
  return [item.title, item.message, item.kind].join(" ").toLowerCase().includes(query);
}

function compareString(a: string, b: string) {
  return a.localeCompare(b);
}

function logNotificationsPatchDebug(label: string, context: NotificationsPatchDebugContext) {
  console.error(
    label,
    JSON.stringify({
      ...context,
      switched: context.sessionUid !== context.authUid,
    }),
  );
}

function sortNotifications(
  rows: NotificationItem[],
  sortBy: NotificationSortBy,
  sortDir: "asc" | "desc",
) {
  const direction = sortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const valueA =
      sortBy === "createdAt"
        ? toUnixMillis(a.createdAt)
        : sortBy === "title"
          ? a.title
          : sortBy === "message"
            ? a.message
            : sortBy === "kind"
              ? a.kind
              : a.seen ? 1 : 0;
    const valueB =
      sortBy === "createdAt"
        ? toUnixMillis(b.createdAt)
        : sortBy === "title"
          ? b.title
          : sortBy === "message"
            ? b.message
            : sortBy === "kind"
              ? b.kind
              : b.seen ? 1 : 0;

    const compared =
      typeof valueA === "number" && typeof valueB === "number"
        ? valueA - valueB
        : compareString(String(valueA), String(valueB));
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

  const unseenOnly = parseBooleanParam(request.nextUrl.searchParams.get("unseen"));
  const summaryMode = request.nextUrl.searchParams.get("summary") === "count";
  const requestedPage = parsePositiveInt(request.nextUrl.searchParams.get("page"), 1);
  const requestedLimit = parsePositiveInt(request.nextUrl.searchParams.get("limit"), DEFAULT_PAGE_SIZE);
  const pageSize = Math.min(MAX_PAGE_SIZE, requestedLimit);
  const query = normalizeSearch(request.nextUrl.searchParams.get("q"));
  const sortBy = parseSortBy(request.nextUrl.searchParams.get("sortBy"));
  const sortDir = parseSortDir(request.nextUrl.searchParams.get("sortDir"));

  const operationStartedAt = Date.now();
  try {
    const { data, session: refreshedSession, refreshed } =
      await runWithRefreshedFirebaseToken(session, async (idToken) => {
        const familyId = await getPrimaryFamilyId(session.uid, idToken);
        if (!familyId) {
          return { notifications: [] as NotificationItem[], unseenCount: 0 };
        }

        const requester = await getRequesterContext(
          familyId,
          session.uid,
          session.email,
          idToken,
        );

        const [notificationDocs, seenDocs] = await Promise.all([
          runQuery(
            {
              from: [{ collectionId: "notifications" }],
              orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
              limit: RECENT_NOTIFICATION_LIMIT,
            },
            idToken,
            `families/${familyId}`,
          ),
          runQuery(
            {
              from: [{ collectionId: "notificationSeen" }],
              where: {
                fieldFilter: {
                  field: { fieldPath: "uid" },
                  op: "EQUAL",
                  value: { stringValue: session.uid },
                },
              },
              limit: VIEWER_SEEN_MARKER_LIMIT,
            },
            idToken,
            `families/${familyId}`,
          ),
        ]);

        const seenIds = new Set(
          seenDocs
            .map((doc) => readString(doc.fields, "notificationId"))
            .filter((value) => value.length > 0),
        );

        const visible = notificationDocs
          .map((doc) => {
            const id = documentIdFromName(doc.name);
            const actorUid = readString(doc.fields, "actorUid");
            const relatedIds = readStringArray(doc.fields, "relatedIds");
            const triggeredByViewer = actorUid === session.uid;
            const visibleToViewer =
              requester.role === "admin"
                ? true
                : isVisibleToPlayer(relatedIds, requester.aliases);
            if (!visibleToViewer) {
              return null;
            }
            const seen = triggeredByViewer || seenIds.has(id);
            return {
              id,
              kind: readString(doc.fields, "kind"),
              title: readString(doc.fields, "title"),
              message: readString(doc.fields, "message"),
              createdAt: readTimestamp(doc.fields, "createdAt"),
              seen,
              triggeredByViewer,
            } satisfies NotificationItem;
          })
          .filter((entry): entry is NotificationItem => Boolean(entry))
          .sort((a, b) => toUnixMillis(b.createdAt) - toUnixMillis(a.createdAt));

        const unseenCount = visible.filter((entry) => !entry.seen).length;
        const notifications = unseenOnly
          ? visible.filter((entry) => !entry.seen)
          : visible;
        const filtered = notifications.filter((entry) => matchesSearch(entry, query));
        const sorted = sortNotifications(filtered, sortBy, sortDir);
        const pagination = paginate(sorted, requestedPage, pageSize);

        if (summaryMode) {
          return { notifications: [] as NotificationItem[], unseenCount };
        }

        return {
          notifications: pagination.rows,
          unseenCount,
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
    const notificationsPagination = "pagination" in data ? data.pagination : undefined;
    void recordOperationMetric({
      area: "notifications",
      operation: summaryMode ? "unseen_count" : "list",
      durationMs: Date.now() - operationStartedAt,
      status: "ok",
      resultCount: data.notifications.length,
      requestedLimit: summaryMode ? undefined : pageSize,
      hasNextPage: notificationsPagination
        ? notificationsPagination.page < notificationsPagination.totalPages
        : false,
      cursorConsumed: true,
      userId: session.uid,
      metadata: { unseenCount: data.unseenCount, summaryMode },
    });
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[NOTIFICATIONS_GET_ERROR]", reason);
    void recordOperationMetric({
      area: "notifications",
      operation: summaryMode ? "unseen_count" : "list",
      durationMs: Date.now() - operationStartedAt,
      status: "error",
      errorCode: reason,
      requestedLimit: summaryMode ? undefined : pageSize,
      userId: session.uid,
    });
    return mapCommonFirestoreErrors(reason, "notifications_unavailable");
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

  let body: MarkSeenBody;
  try {
    body = (await request.json()) as MarkSeenBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const ids = Array.isArray(body.ids)
    ? body.ids
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    : [];

  if (ids.length === 0) {
    return NextResponse.json({ error: "ids_required" }, { status: 400 });
  }

  try {
    let debugContext: NotificationsPatchDebugContext | null = null;
    const { session: refreshedSession, refreshed } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        const familyId = await getPrimaryFamilyId(session.uid, idToken);
        if (!familyId) {
          return null;
        }
        const requester = await getRequesterContext(
          familyId,
          session.uid,
          session.email,
          idToken,
        );
        const notificationDocs = await Promise.all(
          ids.map(async (notificationId) => {
            try {
              const doc = await getDocument(`families/${familyId}/notifications/${notificationId}`, idToken);
              return { id: notificationId, doc };
            } catch (error) {
              const reason = error instanceof Error ? error.message : "";
              if (reason.includes("FIRESTORE_HTTP_404")) {
                return null;
              }
              throw error;
            }
          }),
        );

        const visibleIds = notificationDocs
          .map((entry) => {
            if (!entry) {
              return null;
            }
            const actorUid = readString(entry.doc.fields, "actorUid");
            const relatedIds = readStringArray(entry.doc.fields, "relatedIds");
            const triggeredByViewer = actorUid === session.uid;
            const visibleToViewer =
              requester.role === "admin"
                ? true
                : isVisibleToPlayer(relatedIds, requester.aliases);
            if (!visibleToViewer || triggeredByViewer) {
              return null;
            }
            return entry.id;
          })
          .filter((notificationId): notificationId is string => Boolean(notificationId));

        debugContext = {
          sessionUid: session.uid,
          sessionEmail: session.email,
          authUid: session.authUid || session.uid,
          authEmail: session.authEmail || session.email,
          familyId,
          requesterRole: requester.role,
          requesterAliases: [...requester.aliases].sort(),
          requestedIds: ids,
          visibleIds,
        };

        if (visibleIds.length === 0) {
          logNotificationsPatchDebug("[NOTIFICATIONS_PATCH_SKIP]", debugContext);
          return null;
        }
        const now = new Date().toISOString();
        try {
          await Promise.all(
            visibleIds.map((notificationId) =>
              createOrReplaceDocument(
                `families/${familyId}/notificationSeen/${session.uid}_${notificationId}`,
                {
                  uid: stringField(session.uid),
                  viewerAuthUid: stringField(session.authUid || session.uid),
                  notificationId: stringField(notificationId),
                  seenAt: timestampField(now),
                  updatedAt: timestampField(now),
                },
                idToken,
              ),
            ),
          );
        } catch (error) {
          if (debugContext) {
            logNotificationsPatchDebug("[NOTIFICATIONS_PATCH_WRITE_DEBUG]", debugContext);
          }
          throw error;
        }
        return null;
      },
    );

    const response = NextResponse.json({ success: true });
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[NOTIFICATIONS_PATCH_ERROR]", reason);
    return mapCommonFirestoreErrors(reason, "notifications_update_failed");
  }
}
