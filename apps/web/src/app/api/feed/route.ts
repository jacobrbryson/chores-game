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
  readInteger,
  readString,
  readStringArray,
  readTimestamp,
} from "@/lib/firestore/rest";
import { adminListAllDocuments, adminRunQueryAt } from "@/lib/firestore/admin";
import {
  canShareFriendFeedKind,
  firstNameOnly,
  friendSafeMessage,
} from "@/lib/family-friends/model";
import { listFamilyFriends } from "@/lib/family-friends/repository";
import {
  collapseCompletedRoutineSteps,
  feedDayLabelKey,
  feedDayRollupTier,
  feedTypeAction,
  feedTypeIcon,
  groupDailyFeedActivity,
  isFeedEventVisibleToViewer,
  mapNotificationKindToFeedType,
  parseFeedRoutineSteps,
  routineNameFromFeedMessage,
  type FeedDayRollupGroup,
  type FeedDayRollupKind,
  type FeedEventType,
  type FeedRoutineStep,
} from "@/lib/feed/feed-events";
import { recordOperationMetric } from "@/lib/observability/metrics";

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
  sourceFamily: { id: string; name: string; isFriend: boolean };
  metadata: {
    choreId?: string;
    choreTitle?: string;
    rewardId?: string;
    rewardDescription?: string;
    rewardCoinCost?: number;
    rewardImageId?: string;
    routineId?: string;
    routineName?: string;
    routineSteps?: FeedRoutineStep[];
    // Daily roll-up card: the chores one person finished (or added) on `day`.
    day?: string;
    dayKind?: FeedDayRollupKind;
    dayChoreCount?: number;
    dayCoinsEarned?: number;
    dayChores?: FeedRoutineStep[];
  };
};

const MAX_TIMEZONE_OFFSET_MINUTES = 14 * 60;

function parseTimezoneOffsetMinutes(value: string | null) {
  if (value === null) {
    return 0;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  const rounded = Math.trunc(parsed);
  return Math.abs(rounded) > MAX_TIMEZONE_OFFSET_MINUTES ? 0 : rounded;
}

// English headline for a daily roll-up. Feed messages are server-built English
// (they come straight from stored activity records); up-to-date clients render
// their own localized headline from the metadata and use this as the fallback.
function dayRollupMessage(
  group: FeedDayRollupGroup<FeedItem>,
  kind: FeedDayRollupKind,
  tzOffsetMinutes: number,
): string {
  const count = group.chores.length;
  const labelKey = feedDayLabelKey(group.dayKey, tzOffsetMinutes);
  const when =
    labelKey === "today"
      ? "today"
      : labelKey === "yesterday"
        ? "yesterday"
        : `on ${new Date(`${group.dayKey}T12:00:00Z`).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          })}`;
  if (kind === "created") {
    return `📝 ${group.actorName} added ${count} chores ${when}.`;
  }
  const tier = feedDayRollupTier(count);
  if (tier === "steady") {
    return `✅ ${group.actorName} completed ${count} chores ${when}.`;
  }
  const flair =
    tier === "unstoppable"
      ? "🚀 {name} is unstoppable"
      : tier === "fire"
        ? "🔥 {name} is on fire"
        : "✨ {name} is on a roll";
  return `${flair.replace("{name}", group.actorName)} with ${count} chores completed ${when}!`;
}

// One card standing in for a person's chores of one kind on a single day.
function buildDayRollupItem(
  group: FeedDayRollupGroup<FeedItem>,
  kind: FeedDayRollupKind,
  tzOffsetMinutes: number,
): FeedItem {
  // The card inherits the day's most recent completion, so it sorts into the
  // feed exactly where that completion would have.
  const newest = group.items.reduce((latest, item) =>
    Date.parse(item.createdAt) > Date.parse(latest.createdAt) ? item : latest,
  );
  const type: FeedEventType = kind === "created" ? "chore_created" : "chore_completed";
  return {
    id: `${newest.sourceFamily.id}:day:${kind}:${group.actorKey}:${group.dayKey}`,
    type,
    title: newest.title,
    message: dayRollupMessage(group, kind, tzOffsetMinutes),
    actor: newest.actor,
    icon: feedTypeIcon(type),
    action: feedTypeAction(type),
    createdAt: newest.createdAt,
    sourceFamily: newest.sourceFamily,
    metadata: {
      day: group.dayKey,
      dayKind: kind,
      dayChoreCount: group.chores.length,
      dayCoinsEarned: group.coinsEarned,
      dayChores: group.chores,
    },
  } satisfies FeedItem;
}

// Collapses both kinds of repeat daily activity — chores finished and chores
// added — into one card per person per day.
function rollUpDailyActivity(items: FeedItem[], tzOffsetMinutes: number): FeedItem[] {
  return (["completed", "created"] as const).reduce(
    (current, kind) =>
      groupDailyFeedActivity(current, {
        groupType: kind === "created" ? "chore_created" : "chore_completed",
        tzOffsetMinutes,
        createSummary: (group) => buildDayRollupItem(group, kind, tzOffsetMinutes),
      }),
    items,
  );
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
  rolesByAlias: Map<string, "admin" | "player">;
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
  const rolesByAlias = new Map<string, "admin" | "player">();
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
    const memberRole = readString(doc.fields, "role") === "admin" ? "admin" : "player";
    for (const key of [memberId, memberUid, memberEmail]) {
      if (key) {
        actorsByAlias.set(normalize(key), actor);
        rolesByAlias.set(normalize(key), memberRole);
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

  return { role, aliases, actorsByAlias, rolesByAlias };
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

function normalizeCompletionDisplay(params: {
  context: ViewerContext;
  type: FeedEventType;
  actorUid: string;
  actorEmail: string;
  relatedIds: string[];
  message: string;
  recordedActor: FeedActor | null;
}) {
  const { context, type, actorUid, actorEmail, relatedIds, message, recordedActor } = params;
  if ((type !== "chore_completed" && type !== "routine_completed") || !recordedActor) {
    return { actor: recordedActor, message };
  }
  const actorRole = [actorUid, actorEmail, recordedActor.uid]
    .filter(Boolean)
    .map((alias) => context.rolesByAlias.get(normalize(alias)))
    .find(Boolean);
  if (actorRole !== "admin") {
    return { actor: recordedActor, message };
  }
  const childActor = relatedIds
    .map((alias) => ({
      actor: context.actorsByAlias.get(normalize(alias)),
      role: context.rolesByAlias.get(normalize(alias)),
    }))
    .find((candidate) => candidate.actor && candidate.role === "player")?.actor;
  if (!childActor) {
    return { actor: recordedActor, message };
  }

  const markedPrefix = `${recordedActor.name} marked `;
  if (message.startsWith(markedPrefix)) {
    const detail = message.slice(markedPrefix.length);
    const completeIndex = detail.lastIndexOf(" complete");
    if (completeIndex >= 0) {
      return {
        actor: childActor,
        message: `${childActor.name} completed ${detail.slice(0, completeIndex)}${detail.slice(completeIndex + " complete".length)}`,
      };
    }
  }
  const actorPrefix = `${recordedActor.name} `;
  return {
    actor: childActor,
    message: message.startsWith(actorPrefix)
      ? `${childActor.name} ${message.slice(actorPrefix.length)}`
      : message,
  };
}

function redactFriendMemberNames(value: string, context: ViewerContext, actorName: string) {
  let safe = friendSafeMessage(value, actorName);
  const names = new Set(Array.from(context.actorsByAlias.values()).map((actor) => actor.name).filter(Boolean));
  for (const name of names) {
    safe = friendSafeMessage(safe, name);
  }
  return safe;
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
  const friendsOnly = searchParams.get("scope") === "friends";
  // Daily roll-ups are grouped by the viewer's calendar day, so "today" means
  // today where they are. Defaults to UTC when the client sends no offset.
  const tzOffsetMinutes = parseTimezoneOffsetMinutes(searchParams.get("tzOffsetMinutes"));

  const operationStartedAt = Date.now();
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

        const [memberDocs, notificationDocs, friends] = await Promise.all([
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
          listFamilyFriends(familyId),
        ]);

        const context = buildViewerContext(memberDocs, session.uid, session.email);

        const ownFeedItems = notificationDocs
          .map((doc): FeedItem | null => {
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
            const routineSteps = parseFeedRoutineSteps(readString(doc.fields, "routineStepsJson"));
            const display = normalizeCompletionDisplay({
              context,
              type,
              actorUid,
              actorEmail,
              relatedIds,
              message: readString(doc.fields, "message"),
              recordedActor: resolveActor(
                context,
                actorUid,
                actorEmail,
                readString(doc.fields, "actorName"),
              ),
            });
            return {
              id: documentIdFromName(doc.name),
              type,
              title: readString(doc.fields, "title"),
              message: display.message,
              actor: display.actor,
              icon: feedTypeIcon(type),
              action: feedTypeAction(type),
              createdAt: readTimestamp(doc.fields, "createdAt"),
              sourceFamily: { id: familyId, name: "", isFriend: false },
              metadata: {
                ...(choreId ? { choreId } : {}),
                ...(choreTitle ? { choreTitle } : {}),
                ...(readString(doc.fields, "rewardId") ? { rewardId: readString(doc.fields, "rewardId") } : {}),
                ...(readString(doc.fields, "rewardDescription") ? { rewardDescription: readString(doc.fields, "rewardDescription") } : {}),
                ...(readInteger(doc.fields, "rewardCoinCost") ? { rewardCoinCost: readInteger(doc.fields, "rewardCoinCost") } : {}),
                ...(readString(doc.fields, "rewardImageId") ? { rewardImageId: readString(doc.fields, "rewardImageId") } : {}),
                ...(readString(doc.fields, "routineId") ? { routineId: readString(doc.fields, "routineId") } : {}),
                ...(readString(doc.fields, "routineName") ? { routineName: readString(doc.fields, "routineName") } : {}),
                ...(routineSteps.length ? { routineSteps } : {}),
              },
            } satisfies FeedItem;
          })
          .filter((entry): entry is FeedItem => Boolean(entry));

        // A finished routine is one card listing its chores, so drop the
        // per-step completion/approval events it already covers. What is left is
        // then rolled up per person per day, so a busy day is one card too.
        const ownVisible = rollUpDailyActivity(
          collapseCompletedRoutineSteps(ownFeedItems),
          tzOffsetMinutes,
        );

        const friendBatches = await Promise.all(
          friends.map(async (friend) => {
            const [friendNotifications, friendMembers] = await Promise.all([
              adminRunQueryAt(`families/${friend.familyId}`, {
                from: [{ collectionId: "notifications" }],
                orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
                limit: 100,
              }),
              adminListAllDocuments(`families/${friend.familyId}/members`, { cap: 200 }),
            ]);
            const friendContext = buildViewerContext(friendMembers, "", "");
            const friendItems = friendNotifications
              .map((doc): FeedItem | null => {
                const kind = readString(doc.fields, "kind");
                if (!canShareFriendFeedKind(kind, context.role)) return null;
                const type = mapNotificationKindToFeedType(kind);
                if (!type) return null;
                const actorUid = readString(doc.fields, "actorUid");
                const actorEmail = readString(doc.fields, "actorEmail");
                const rawActorName = readString(doc.fields, "actorName");
                const resolved = resolveActor(friendContext, actorUid, actorEmail, rawActorName);
                const display = normalizeCompletionDisplay({
                  context: friendContext,
                  type,
                  actorUid,
                  actorEmail,
                  relatedIds: readStringArray(doc.fields, "relatedIds"),
                  message: readString(doc.fields, "message"),
                  recordedActor: resolved,
                });
                const actor = display.actor
                  ? { ...display.actor, name: firstNameOnly(display.actor.name) }
                  : null;
                const actorNameForRedaction = rawActorName || resolved?.name || "";
                const rewardId = readString(doc.fields, "rewardId");
                const routineName =
                  readString(doc.fields, "routineName") ||
                  routineNameFromFeedMessage(readString(doc.fields, "message"));
                const routineSteps = parseFeedRoutineSteps(
                  readString(doc.fields, "routineStepsJson"),
                ).map((step) => ({
                  ...step,
                  title: redactFriendMemberNames(step.title, friendContext, actorNameForRedaction),
                }));
                return {
                  id: `${friend.familyId}:${documentIdFromName(doc.name)}`,
                  type,
                  title: redactFriendMemberNames(readString(doc.fields, "title"), friendContext, actorNameForRedaction),
                  message: redactFriendMemberNames(display.message, friendContext, actorNameForRedaction),
                  actor,
                  icon: feedTypeIcon(type),
                  action:
                    feedTypeAction(type) === "copy_friend_routine" && context.role !== "admin"
                      ? null
                      : feedTypeAction(type),
                  createdAt: readTimestamp(doc.fields, "createdAt"),
                  sourceFamily: { id: friend.familyId, name: friend.familyName, isFriend: true },
                  metadata: {
                    ...(readString(doc.fields, "choreId") ? { choreId: readString(doc.fields, "choreId") } : {}),
                    ...(readString(doc.fields, "choreTitle") ? { choreTitle: readString(doc.fields, "choreTitle") } : {}),
                    ...(rewardId ? { rewardId } : {}),
                    ...(readString(doc.fields, "rewardDescription") ? { rewardDescription: readString(doc.fields, "rewardDescription") } : {}),
                    ...(readInteger(doc.fields, "rewardCoinCost") ? { rewardCoinCost: readInteger(doc.fields, "rewardCoinCost") } : {}),
                    ...(readString(doc.fields, "rewardImageId") ? { rewardImageId: readString(doc.fields, "rewardImageId") } : {}),
                    ...(context.role === "admin" && readString(doc.fields, "routineId")
                      ? { routineId: readString(doc.fields, "routineId") }
                      : {}),
                    ...(routineName ? { routineName } : {}),
                    ...(routineSteps.length ? { routineSteps } : {}),
                  },
                } satisfies FeedItem;
              })
              .filter((entry): entry is FeedItem => Boolean(entry));
            return rollUpDailyActivity(
              collapseCompletedRoutineSteps(friendItems),
              tzOffsetMinutes,
            );
          }),
        );

        const friendVisible = friendBatches.flat();
        const visible = (friendsOnly ? friendVisible : [...ownVisible, ...friendVisible])
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
    void recordOperationMetric({
      area: "feed",
      operation: "list",
      durationMs: Date.now() - operationStartedAt,
      status: "ok",
      resultCount: data.items.length,
      requestedLimit: pageSize,
      hasNextPage: data.pagination.hasMore,
      cursorConsumed: true,
      userId: session.uid,
      metadata: { page: data.pagination.page, total: data.pagination.total },
    });
    return response;
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.slice(0, 180) : "unknown";
    console.error("[FEED_GET_ERROR]", reason);
    void recordOperationMetric({
      area: "feed",
      operation: "list",
      durationMs: Date.now() - operationStartedAt,
      status: "error",
      errorCode: reason,
      requestedLimit: pageSize,
      userId: session.uid,
    });
    return mapCommonFirestoreErrors(reason);
  }
}
