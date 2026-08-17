import { describe, expect, it } from "vitest";
import { localeMessages, SUPPORTED_LOCALES } from "@packages/locales";
import {
  FEED_EVENT_TYPES,
  collapseCompletedRoutineSteps,
  feedDayKey,
  feedDayLabelKey,
  feedDayRollupTier,
  feedTypeAction,
  feedTypeIcon,
  groupDailyFeedActivity,
  isFeedEventVisibleToViewer,
  mapNotificationKindToFeedType,
  parseFeedRoutineSteps,
  parseRoutineStepMessage,
  routineNameFromFeedMessage,
  type FeedDayRollupGroup,
  type FeedEventType,
  type FeedRoutineStep,
} from "./feed-events";

describe("feed event mapping", () => {
  it("maps high-priority notification kinds to feed types", () => {
    expect(mapNotificationKindToFeedType("chore_completed")).toBe("chore_completed");
    expect(mapNotificationKindToFeedType("chore_approved")).toBe("chore_approved");
    expect(mapNotificationKindToFeedType("chore_rejected")).toBe("chore_rejected");
    expect(mapNotificationKindToFeedType("chore_created")).toBe("chore_created");
    expect(mapNotificationKindToFeedType("reward_claimed")).toBe("reward_claimed");
    expect(mapNotificationKindToFeedType("routine_created")).toBe("routine_created");
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
    expect(feedTypeAction("routine_created")).toBe("copy_friend_routine");
    expect(feedTypeAction("routine_completed")).toBe("copy_friend_routine");
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

describe("legacy routine feed metadata", () => {
  it("extracts the routine name from completion and creation messages", () => {
    expect(
      routineNameFromFeedMessage('🎉 Addy finished the "Morning" routine and earned 2 bonus coins!'),
    ).toBe("Morning");
    expect(routineNameFromFeedMessage('A parent added the "Bedtime" routine (4 steps).')).toBe(
      "Bedtime",
    );
    expect(routineNameFromFeedMessage("Routine completed")).toBe("");
  });
});

type TestFeedItem = {
  id: string;
  type: FeedEventType;
  message: string;
  createdAt: string;
  actor: { uid: string; name: string } | null;
  metadata: {
    choreId?: string;
    choreTitle?: string;
    routineName?: string;
    routineSteps?: FeedRoutineStep[];
    day?: string;
    dayChores?: FeedRoutineStep[];
  };
};

function testItem(
  id: string,
  type: FeedEventType,
  overrides: Partial<Omit<TestFeedItem, "id" | "type">> = {},
): TestFeedItem {
  return {
    id,
    type,
    message: "",
    createdAt: "2026-06-05T10:00:00.000Z",
    actor: { uid: "child-uid", name: "Thomas" },
    metadata: {},
    ...overrides,
  };
}

describe("routine completion roll-up", () => {
  const item = (
    id: string,
    type: FeedEventType,
    metadata: { choreId?: string; routineSteps?: FeedRoutineStep[] } = {},
  ) => testItem(id, type, { metadata });

  it("parses a routine step snapshot and ignores malformed entries", () => {
    expect(
      parseFeedRoutineSteps(
        JSON.stringify([
          { choreId: "c1", title: "Water the grass", coinValue: 5, skipped: false },
          { choreId: "c2", title: "Feed the dog", coinValue: "3", skipped: true },
          { choreId: "c3", coinValue: 2 },
        ]),
      ),
    ).toEqual([
      { choreId: "c1", title: "Water the grass", coinValue: 5, skipped: false },
      { choreId: "c2", title: "Feed the dog", coinValue: 3, skipped: true },
    ]);
    expect(parseFeedRoutineSteps("")).toEqual([]);
    expect(parseFeedRoutineSteps("not json")).toEqual([]);
    expect(parseFeedRoutineSteps('{"choreId":"c1"}')).toEqual([]);
  });

  it("drops the per-step events a completed routine already lists", () => {
    const steps = parseFeedRoutineSteps(
      JSON.stringify([
        { choreId: "step-1", title: "Fill dog water bowl", coinValue: 5, skipped: false },
        { choreId: "step-2", title: "Water the grass", coinValue: 5, skipped: false },
      ]),
    );
    const collapsed = collapseCompletedRoutineSteps([
      item("done", "routine_completed", { routineSteps: steps }),
      item("s1", "chore_completed", { choreId: "step-1" }),
      item("s2", "chore_approved", { choreId: "step-2" }),
      item("other", "chore_completed", { choreId: "loose-chore" }),
      item("created", "chore_created", { choreId: "step-1" }),
    ]);
    expect(collapsed.map((entry) => entry.id)).toEqual(["done", "other", "created"]);
  });

  it("leaves the feed untouched when nothing can be rolled up", () => {
    const items = [
      item("legacy", "routine_completed"),
      item("s1", "chore_completed", { choreId: "step-1" }),
    ];
    expect(collapseCompletedRoutineSteps(items)).toBe(items);
  });
});

describe("legacy routine roll-up", () => {
  it("reads the routine, chore, order, and coins out of a step message", () => {
    expect(
      parseRoutineStepMessage(
        'Thomas completed "🥕 Water vegetables" (step 6 of 6 in the "Water plants and animals" routine) and earned 5 coins.',
      ),
    ).toEqual({
      routineName: "Water plants and animals",
      choreTitle: "🥕 Water vegetables",
      order: 6,
      coinValue: 5,
    });
    expect(
      parseRoutineStepMessage('Thomas completed "Feed the dog" (part of the "Morning" routine).'),
    ).toEqual({ routineName: "Morning", choreTitle: "Feed the dog", order: 0, coinValue: 0 });
    expect(parseRoutineStepMessage('Thomas completed "Clean main floor" and earned 5 coins.')).toBeNull();
  });

  it("rebuilds the chore list for a routine completed before snapshots existed", () => {
    const collapsed = collapseCompletedRoutineSteps([
      testItem("final-step", "chore_completed", {
        createdAt: "2026-06-05T10:00:06.000Z",
        message:
          'Thomas completed "Water vegetables" (step 2 of 2 in the "Water plants" routine) and earned 5 coins.',
        metadata: { choreId: "step-2", choreTitle: "Water vegetables" },
      }),
      testItem("routine-done", "routine_completed", {
        createdAt: "2026-06-05T10:00:05.000Z",
        message: '🎉 Thomas finished the "Water plants" routine and earned 5 bonus coins!',
        metadata: { routineName: "Water plants" },
      }),
      testItem("first-step", "chore_completed", {
        createdAt: "2026-06-05T09:30:00.000Z",
        message:
          'Thomas completed "Fill dog water bowl" (step 1 of 2 in the "Water plants" routine) and earned 5 coins.',
        metadata: { choreId: "step-1", choreTitle: "Fill dog water bowl" },
      }),
      testItem("loose", "chore_completed", {
        createdAt: "2026-06-05T09:00:00.000Z",
        message: 'Thomas completed "Clean main floor" and earned 5 coins.',
        metadata: { choreId: "other-chore", choreTitle: "Clean main floor" },
      }),
    ]);
    expect(collapsed.map((entry) => entry.id)).toEqual(["routine-done", "loose"]);
    expect(collapsed[0].metadata.routineSteps).toEqual([
      { choreId: "step-1", title: "Fill dog water bowl", coinValue: 5, skipped: false },
      { choreId: "step-2", title: "Water vegetables", coinValue: 5, skipped: false },
    ]);
  });

  it("keeps a sibling's identically named routine steps apart", () => {
    const collapsed = collapseCompletedRoutineSteps([
      testItem("routine-done", "routine_completed", {
        createdAt: "2026-06-05T10:00:05.000Z",
        message: '🎉 Thomas finished the "Morning" routine!',
        metadata: { routineName: "Morning" },
      }),
      testItem("thomas-step", "chore_completed", {
        createdAt: "2026-06-05T09:30:00.000Z",
        message: 'Thomas completed "Make bed" (step 1 of 1 in the "Morning" routine).',
        metadata: { choreId: "step-1", choreTitle: "Make bed" },
      }),
      testItem("sibling-step", "chore_completed", {
        createdAt: "2026-06-05T09:31:00.000Z",
        actor: { uid: "sibling-uid", name: "Ada" },
        message: 'Ada completed "Make bed" (step 1 of 1 in the "Morning" routine).',
        metadata: { choreId: "step-9", choreTitle: "Make bed" },
      }),
    ]);
    expect(collapsed.map((entry) => entry.id)).toEqual(["routine-done", "sibling-step"]);
    expect(collapsed[0].metadata.routineSteps).toHaveLength(1);
  });

  it("does not reach back past its own lookback window", () => {
    const items = [
      testItem("routine-done", "routine_completed", {
        createdAt: "2026-06-05T10:00:00.000Z",
        message: '🎉 Thomas finished the "Morning" routine!',
        metadata: { routineName: "Morning" },
      }),
      testItem("ancient-step", "chore_completed", {
        createdAt: "2026-06-01T09:00:00.000Z",
        message: 'Thomas completed "Make bed" (step 1 of 1 in the "Morning" routine).',
        metadata: { choreId: "step-1", choreTitle: "Make bed" },
      }),
    ];
    expect(collapseCompletedRoutineSteps(items)).toBe(items);
  });
});

describe("daily chore roll-up", () => {
  it("picks a flair tier from the day's count", () => {
    expect(feedDayRollupTier(2)).toBe("steady");
    expect(feedDayRollupTier(3)).toBe("roll");
    expect(feedDayRollupTier(5)).toBe("roll");
    expect(feedDayRollupTier(6)).toBe("fire");
    expect(feedDayRollupTier(12)).toBe("unstoppable");
  });

  it("buckets events into the viewer's calendar day, not UTC's", () => {
    // 01:30 UTC is still the previous evening at UTC-6.
    expect(feedDayKey("2026-06-06T01:30:00.000Z", 360)).toBe("2026-06-05");
    expect(feedDayKey("2026-06-06T01:30:00.000Z", 0)).toBe("2026-06-06");
    expect(feedDayLabelKey("2026-06-05", 360, Date.parse("2026-06-06T01:30:00.000Z"))).toBe("today");
    expect(feedDayLabelKey("2026-06-04", 360, Date.parse("2026-06-06T01:30:00.000Z"))).toBe(
      "yesterday",
    );
    expect(feedDayLabelKey("2026-05-30", 360, Date.parse("2026-06-06T01:30:00.000Z"))).toBe("date");
  });

  it("replaces a busy day with one summary per person, in place", () => {
    const completion = (id: string, choreId: string, at: string, coins = 5) =>
      testItem(id, "chore_completed", {
        createdAt: at,
        message: `Thomas completed "${choreId}" and earned ${coins} coins.`,
        metadata: { choreId, choreTitle: choreId },
      });
    const grouped = groupDailyFeedActivity(
      [
        completion("c3", "chore-3", "2026-06-05T18:00:00.000Z"),
        completion("c2", "chore-2", "2026-06-05T14:00:00.000Z"),
        testItem("reward", "reward_claimed", { createdAt: "2026-06-05T13:00:00.000Z" }),
        completion("c1", "chore-1", "2026-06-05T09:00:00.000Z"),
        completion("y1", "chore-4", "2026-06-04T09:00:00.000Z"),
      ],
      {
        groupType: "chore_completed",
        tzOffsetMinutes: 0,
        createSummary: (group: FeedDayRollupGroup<TestFeedItem>) =>
          testItem(`summary-${group.dayKey}`, "chore_completed", {
            createdAt: group.items[0].createdAt,
            metadata: { day: group.dayKey, dayChores: group.chores },
          }),
      },
    );
    // The three same-day completions collapse where the newest one was; the
    // reward and the lone previous-day completion are untouched.
    expect(grouped.map((entry: TestFeedItem) => entry.id)).toEqual([
      "summary-2026-06-05",
      "reward",
      "y1",
    ]);
    expect(grouped[0].metadata.dayChores).toEqual([
      { choreId: "chore-1", title: "chore-1", coinValue: 5, skipped: false },
      { choreId: "chore-2", title: "chore-2", coinValue: 5, skipped: false },
      { choreId: "chore-3", title: "chore-3", coinValue: 5, skipped: false },
    ]);
  });

  it("keeps each person's day separate and leaves a lone chore alone", () => {
    const items = [
      testItem("t1", "chore_completed", {
        createdAt: "2026-06-05T09:00:00.000Z",
        metadata: { choreId: "c1", choreTitle: "Dishes" },
      }),
      testItem("a1", "chore_completed", {
        createdAt: "2026-06-05T11:00:00.000Z",
        actor: { uid: "sibling-uid", name: "Ada" },
        metadata: { choreId: "c3", choreTitle: "Laundry" },
      }),
    ];
    expect(
      groupDailyFeedActivity(items, {
        groupType: "chore_completed",
        tzOffsetMinutes: 0,
        createSummary: () => testItem("summary", "chore_completed"),
      }),
    ).toBe(items);
  });

  it("groups added chores separately from completed ones", () => {
    const added = (id: string, title: string, at: string) =>
      testItem(id, "chore_created", {
        createdAt: at,
        message: `Ross added "${title}" (5 coins).`,
        metadata: { choreId: id },
      });
    const grouped = groupDailyFeedActivity(
      [
        added("a2", "Sweep the porch", "2026-06-05T12:00:00.000Z"),
        added("a1", "Go through kid's clothes", "2026-06-05T11:00:00.000Z"),
        testItem("done", "chore_completed", {
          createdAt: "2026-06-05T10:00:00.000Z",
          metadata: { choreId: "c9", choreTitle: "Dishes" },
        }),
      ],
      {
        groupType: "chore_created",
        tzOffsetMinutes: 0,
        createSummary: (group: FeedDayRollupGroup<TestFeedItem>) =>
          testItem("added-summary", "chore_created", {
            metadata: { day: group.dayKey, dayChores: group.chores },
          }),
      },
    );
    expect(grouped.map((entry: TestFeedItem) => entry.id)).toEqual(["added-summary", "done"]);
    // Titles and coin values are recovered from the "added" message wording.
    expect(grouped[0].metadata.dayChores).toEqual([
      { choreId: "a1", title: "Go through kid's clothes", coinValue: 5, skipped: false },
      { choreId: "a2", title: "Sweep the porch", coinValue: 5, skipped: false },
    ]);
  });

  it("never folds an existing roll-up card into another one", () => {
    const summary = testItem("existing-summary", "chore_completed", {
      createdAt: "2026-06-05T12:00:00.000Z",
      metadata: { day: "2026-06-05", dayChores: [{ choreId: "c1", title: "Dishes", coinValue: 5, skipped: false }] },
    });
    const items = [
      summary,
      testItem("loose", "chore_completed", {
        createdAt: "2026-06-05T11:00:00.000Z",
        metadata: { choreId: "c2", choreTitle: "Trash" },
      }),
    ];
    expect(
      groupDailyFeedActivity(items, {
        groupType: "chore_completed",
        tzOffsetMinutes: 0,
        createSummary: () => testItem("new-summary", "chore_completed"),
      }),
    ).toBe(items);
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
