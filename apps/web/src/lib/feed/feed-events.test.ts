import { describe, expect, it } from "vitest";
import { localeMessages, SUPPORTED_LOCALES } from "@packages/locales";
import {
  FEED_EVENT_TYPES,
  feedTypeAction,
  feedTypeIcon,
  isFeedEventVisibleToViewer,
  mapNotificationKindToFeedType,
} from "./feed-events";

describe("feed event mapping", () => {
  it("maps high-priority notification kinds to feed types", () => {
    expect(mapNotificationKindToFeedType("chore_completed")).toBe("chore_completed");
    expect(mapNotificationKindToFeedType("chore_approved")).toBe("chore_approved");
    expect(mapNotificationKindToFeedType("chore_rejected")).toBe("chore_rejected");
    expect(mapNotificationKindToFeedType("chore_created")).toBe("chore_created");
    expect(mapNotificationKindToFeedType("reward_claimed")).toBe("reward_claimed");
    expect(mapNotificationKindToFeedType("identity_title_unlocked")).toBe("title_unlocked");
    expect(mapNotificationKindToFeedType("family_reward_created")).toBe("family_award_created");
  });

  it("excludes noisy lifecycle kinds from the feed", () => {
    expect(mapNotificationKindToFeedType("chore_edited")).toBeNull();
    expect(mapNotificationKindToFeedType("chore_deleted")).toBeNull();
    expect(mapNotificationKindToFeedType("chore_undo_completed")).toBeNull();
    expect(mapNotificationKindToFeedType("unknown_kind")).toBeNull();
  });

  it("provides a stable icon and safe action for every feed type", () => {
    for (const type of FEED_EVENT_TYPES) {
      expect(feedTypeIcon(type)).toBeTruthy();
    }
    expect(feedTypeAction("chore_completed")).toBe("view_chore");
    expect(feedTypeAction("reward_claimed")).toBe("view_reward");
    expect(feedTypeAction("title_unlocked")).toBeNull();
    expect(feedTypeAction("family_award_created")).toBe("copy_friend_award");
  });

  it("provides a translated heading for every feed type", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const events = localeMessages[locale].feed.events as Record<string, string>;
      for (const type of FEED_EVENT_TYPES) {
        expect(events[type], `${locale} feed.events.${type}`).toBeTruthy();
      }
    }
  });
});

describe("feed visibility", () => {
  const aliases = new Set(["child-uid", "child@example.com"]);

  it("lets admins see every family event", () => {
    expect(
      isFeedEventVisibleToViewer({ role: "admin", aliases: new Set(), relatedIds: ["someone-else"] }),
    ).toBe(true);
  });

  it("lets players see only events related to them", () => {
    expect(
      isFeedEventVisibleToViewer({ role: "player", aliases, relatedIds: ["child-uid"] }),
    ).toBe(true);
    expect(
      isFeedEventVisibleToViewer({ role: "player", aliases, relatedIds: ["CHILD@EXAMPLE.COM"] }),
    ).toBe(true);
    expect(
      isFeedEventVisibleToViewer({ role: "player", aliases, relatedIds: ["sibling-uid"] }),
    ).toBe(false);
  });
});
