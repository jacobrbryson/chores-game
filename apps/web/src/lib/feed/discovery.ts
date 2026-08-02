import { adminRunQueryAt } from "@/lib/firestore/admin";
import {
  readString,
  readStringArray,
  readTimestamp,
  runQuery,
} from "@/lib/firestore/rest";
import { canShareFriendFeedKind } from "@/lib/family-friends/model";
import { listFamilyFriends } from "@/lib/family-friends/repository";
import {
  isFeedEventVisibleToViewer,
  mapNotificationKindToFeedType,
} from "@/lib/feed/feed-events";
import type { DiscoveryViewerContext } from "@/lib/discovery/types";

const RECENT_OWN_EVENT_LIMIT = 500;
const RECENT_FRIEND_EVENT_LIMIT = 100;

function notificationQuery(limit: number) {
  return {
    from: [{ collectionId: "notifications" }],
    orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" as const }],
    limit,
  };
}

/** Returns timestamps for the same events the merged Family Feed exposes. */
export async function loadVisibleFeedTimestampsForViewer(
  context: DiscoveryViewerContext,
): Promise<string[]> {
  const ownNotifications = await runQuery(
    notificationQuery(RECENT_OWN_EVENT_LIMIT),
    context.idToken,
    `families/${context.familyId}`,
  );
  const viewerAliases = new Set(context.aliases);

  const ownTimestamps = ownNotifications
    .filter((doc) => {
      if (!mapNotificationKindToFeedType(readString(doc.fields, "kind"))) {
        return false;
      }
      const actorUid = readString(doc.fields, "actorUid");
      const actorEmail = readString(doc.fields, "actorEmail");
      return isFeedEventVisibleToViewer({
        role: context.viewerRole,
        aliases: viewerAliases,
        relatedIds: [
          ...readStringArray(doc.fields, "relatedIds"),
          actorUid,
          actorEmail,
        ].filter(Boolean),
      });
    })
    .map((doc) => readTimestamp(doc.fields, "createdAt"))
    .filter(Boolean);

  let friends: Awaited<ReturnType<typeof listFamilyFriends>> = [];
  try {
    friends = await listFamilyFriends(context.familyId);
  } catch (error) {
    console.error(
      "[DISCOVERY_FEED_FRIENDS_ERROR]",
      error instanceof Error ? error.message : error,
    );
    return ownTimestamps;
  }

  const friendTimestampBatches = await Promise.all(
    friends.map(async (friend) => {
      try {
        const notifications = await adminRunQueryAt(
          `families/${friend.familyId}`,
          notificationQuery(RECENT_FRIEND_EVENT_LIMIT),
        );
        return notifications
          .filter((doc) =>
            canShareFriendFeedKind(readString(doc.fields, "kind"), context.viewerRole),
          )
          .map((doc) => readTimestamp(doc.fields, "createdAt"))
          .filter(Boolean);
      } catch (error) {
        console.error(
          "[DISCOVERY_FEED_FRIEND_ERROR]",
          friend.familyId,
          error instanceof Error ? error.message : error,
        );
        return [];
      }
    }),
  );

  return [...ownTimestamps, ...friendTimestampBatches.flat()];
}
