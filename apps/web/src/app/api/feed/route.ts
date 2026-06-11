import { NextRequest, NextResponse } from "next/server";
import { runWithRefreshedFirebaseToken } from "@/lib/auth/firebase-refresh";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { setSessionUserCookie } from "@/lib/auth/session-cookie";
import {
  documentIdFromName,
  getDocument,
  listDocuments,
  runQuery,
  readBoolean,
  readString,
  readStringArray,
  readTimestamp,
} from "@/lib/firestore/rest";
import {
  feedTypeAction,
  feedTypeIcon,
  isFeedEventVisibleToViewer,
  mapNotificationKindToFeedType,
  type FeedEventType,
} from "@/lib/feed/feed-events";

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;
// The feed projects over the unbounded notifications collection, so read the
// most-recent window via an ordered query (single-field index on createdAt)
// rather than an arbitrary unordered page.
const RECENT_NOTIFICATION_LIMIT = 500;

type FeedActor = {
  uid: string;
  name: string;
  avatarId: string;
  avatarPhotoUrl: string;
  primaryColor: string;
};

type FeedItem = {
  id: string;
  type: FeedEventType;
  title: string;
  message: string;
  actor: FeedActor | null;
  icon: string;
  action: ReturnType<typeof feedTypeAction>;
  createdAt: string;
  metadata: {
    choreId?: string;
    choreTitle?: string;
  };
};

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

function mapCommonFirestoreErrors(reason: string) {
  if (reason.includes("FIRESTORE_HTTP_401") || reason.includes("FIREBASE_REFRESH_FAILED")) {
    return jsonReauthRequired();
  }
  if (reason.includes("FIRESTORE_HTTP_403")) {
    return jsonFirestoreForbidden();
  }
  return NextResponse.json({ error: "feed_unavailable" }, { status: 500 });
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function toUnixMillis(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
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
  return normalized <= 0 ? fallback : normalized;
}

async function getPrimaryFamilyId(uid: string, idToken: string) {
  const userDoc = await getDocument(`users/${uid}`, idToken);
  return readStringArray(userDoc.fields, "familyIds")[0] ?? "";
}

type ViewerContext = {
  role: "admin" | "player";
  aliases: Set<string>;
  actorsByAlias: Map<string, FeedActor>;
};

function buildViewerContext(
  memberDocs: Awaited<ReturnType<typeof listDocuments>>,
  viewerUid: string,
  viewerEmail: string,
): ViewerContext {
  const aliases = new Set<string>([normalize(viewerUid)]);
  if (viewerEmail) {
    aliases.add(normalize(viewerEmail));
  }
  const actorsByAlias = new Map<string, FeedActor>();
  let role: "admin" | "player" = "player";
  let roleResolved = false;

  for (const doc of memberDocs) {
    if (readBoolean(doc.fields, "deleted")) {
      continue;
    }
    const memberId = documentIdFromName(doc.name);
    const memberUid = readString(doc.fields, "uid");
    const memberEmail = readString(doc.fields, "email");
    const actor: FeedActor = {
      uid: memberUid || memberId,
      name: readString(doc.fields, "name") || memberEmail || "Family member",
      avatarId: readString(doc.fields, "avatarId"),
      avatarPhotoUrl: readString(doc.fields, "avatarPhotoUrl"),
      primaryColor: readString(doc.fields, "dashboardPrimaryColor"),
    };
    for (const key of [memberId, memberUid, memberEmail]) {
      if (key) {
        actorsByAlias.set(normalize(key), actor);
      }
    }

    const matchesViewer =
      normalize(memberUid) === normalize(viewerUid) ||
      (Boolean(viewerEmail) && normalize(memberEmail) === normalize(viewerEmail));
    if (matchesViewer) {
      aliases.add(normalize(memberId));
      if (memberUid) {
        aliases.add(normalize(memberUid));
      }
      if (memberEmail) {
        aliases.add(normalize(memberEmail));
      }
      if (!roleResolved) {
        role = readString(doc.fields, "role") === "admin" ? "admin" : "player";
        roleResolved = true;
      }
    }
  }

  return { role, aliases, actorsByAlias };
}

function resolveActor(context: ViewerContext, actorUid: string, actorEmail: string, actorName: string): FeedActor | null {
  const byUid = actorUid ? context.actorsByAlias.get(normalize(actorUid)) : undefined;
  if (byUid) {
    return byUid;
  }
  const byEmail = actorEmail ? context.actorsByAlias.get(normalize(actorEmail)) : undefined;
  if (byEmail) {
    return byEmail;
  }
  if (!actorName && !actorUid) {
    return null;
  }
  return {
    uid: actorUid,
    name: actorName || "Family member",
    avatarId: "",
    avatarPhotoUrl: "",
    primaryColor: "",
  };
}

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return jsonUnauthorized();
  }
  if (!session.firebaseIdToken && !session.firebaseRefreshToken) {
    return jsonReauthRequired();
  }

  const searchParams = new URL(request.url).searchParams;
  const requestedPage = parsePositiveInt(searchParams.get("page"), 1);
  const requestedLimit = parsePositiveInt(searchParams.get("limit"), DEFAULT_PAGE_SIZE);
  const pageSize = Math.min(MAX_PAGE_SIZE, requestedLimit);

  try {
    const { data, session: refreshedSession, refreshed } = await runWithRefreshedFirebaseToken(
      session,
      async (idToken) => {
        const familyId = await getPrimaryFamilyId(session.uid, idToken);
        if (!familyId) {
          // Active family required: a signed-in user with no family gets an empty feed
          // rather than an error, mirroring how the dashboard handles the no-family case.
          return {
            items: [] as FeedItem[],
            pagination: { page: 1, pageSize, total: 0, totalPages: 1, hasMore: false },
          };
        }

        const [memberDocs, notificationDocs] = await Promise.all([
          listDocuments(`families/${familyId}/members`, idToken, 200),
          runQuery(
            {
              from: [{ collectionId: "notifications" }],
              orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
              limit: RECENT_NOTIFICATION_LIMIT,
            },
            idToken,
            `families/${familyId}`,
          ),
        ]);

        const context = buildViewerContext(memberDocs, session.uid, session.email);

        const visible = notificationDocs
          .map((doc) => {
            const type = mapNotificationKindToFeedType(readString(doc.fields, "kind"));
            if (!type) {
              return null;
            }
            const relatedIds = readStringArray(doc.fields, "relatedIds");
            const actorUid = readString(doc.fields, "actorUid");
            const actorEmail = readString(doc.fields, "actorEmail");
            const visibleToViewer = isFeedEventVisibleToViewer({
              role: context.role,
              aliases: context.aliases,
              relatedIds: [...relatedIds, actorUid, actorEmail].filter(Boolean),
            });
            if (!visibleToViewer) {
              return null;
            }
            const choreId = readString(doc.fields, "choreId");
            const choreTitle = readString(doc.fields, "choreTitle");
            return {
              id: documentIdFromName(doc.name),
              type,
              title: readString(doc.fields, "title"),
              message: readString(doc.fields, "message"),
              actor: resolveActor(context, actorUid, actorEmail, readString(doc.fields, "actorName")),
              icon: feedTypeIcon(type),
              action: feedTypeAction(type),
              createdAt: readTimestamp(doc.fields, "createdAt"),
              metadata: {
                ...(choreId ? { choreId } : {}),
                ...(choreTitle ? { choreTitle } : {}),
              },
            } satisfies FeedItem;
          })
          .filter((entry): entry is FeedItem => Boolean(entry))
          .sort((a, b) => toUnixMillis(b.createdAt) - toUnixMillis(a.createdAt));

        const total = visible.length;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const safePage = Math.max(1, Math.min(requestedPage, totalPages));
        const offset = (safePage - 1) * pageSize;
        const rows = visible.slice(offset, offset + pageSize);

        return {
          items: rows,
          pagination: {
            page: safePage,
            pageSize,
            total,
            totalPages,
            hasMore: safePage < totalPages,
          },
        };
      },
    );

    const response = NextResponse.json(data);
    if (refreshed) {
      setSessionUserCookie(response, refreshedSession);
    }
    return response;
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[FEED_GET_ERROR]", reason);
    return mapCommonFirestoreErrors(reason);
  }
}
