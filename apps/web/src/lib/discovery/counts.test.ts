import { describe, expect, it } from "vitest";
import {
  countNewByTimestamp,
  countNewChangelog,
  countNewChores,
  countNewCompletedAchievements,
  isUnseen,
  type DiscoveryChoreRecord,
} from "@/lib/discovery/counts";
import { normalizeDiscoverySection, listSectionsForRole } from "@/lib/discovery/sections";
import { canViewerSeeSection } from "@/lib/discovery/visibility";

function chore(partial: Partial<DiscoveryChoreRecord>): DiscoveryChoreRecord {
  return {
    createdAt: "2026-06-01T00:00:00.000Z",
    status: "Open",
    deleted: false,
    assigneeId: "",
    assigneeIds: [],
    assigneeScope: undefined,
    ...partial,
  };
}

describe("isUnseen", () => {
  it("treats a null lastSeen as everything unseen", () => {
    expect(isUnseen("2020-01-01T00:00:00.000Z", null)).toBe(true);
  });
  it("counts only items created strictly after lastSeen", () => {
    const lastSeen = "2026-06-01T12:00:00.000Z";
    expect(isUnseen("2026-06-01T12:00:01.000Z", lastSeen)).toBe(true);
    expect(isUnseen("2026-06-01T11:59:59.000Z", lastSeen)).toBe(false);
  });
  it("ignores items without a timestamp", () => {
    expect(isUnseen(undefined, null)).toBe(false);
  });
});

describe("countNewChores", () => {
  const lastSeen = "2026-06-01T00:00:00.000Z";
  const chores = [
    chore({ createdAt: "2026-06-02T00:00:00.000Z", assigneeId: "player-1" }),
    chore({ createdAt: "2026-06-02T00:00:00.000Z", assigneeIds: ["player-1"] }),
    chore({ createdAt: "2026-06-02T00:00:00.000Z", assigneeId: "player-2" }),
    chore({ createdAt: "2026-05-01T00:00:00.000Z", assigneeId: "player-1" }), // before lastSeen
    chore({ createdAt: "2026-06-02T00:00:00.000Z", assigneeId: "player-1", status: "Approved" }), // not Open
    chore({ createdAt: "2026-06-02T00:00:00.000Z", assigneeId: "player-1", deleted: true }), // deleted
    chore({ createdAt: "2026-06-02T00:00:00.000Z", assigneeScope: "family" }), // visible to all
  ];

  it("counts only the active player's visible new open chores", () => {
    const count = countNewChores({
      chores,
      viewerRole: "player",
      aliases: ["player-1"],
      lastSeenAt: lastSeen,
    });
    // 2 directly assigned + 1 family-scope = 3
    expect(count).toBe(3);
  });

  it("counts all new open family chores for admins", () => {
    const count = countNewChores({
      chores,
      viewerRole: "admin",
      aliases: ["admin-1"],
      lastSeenAt: lastSeen,
    });
    // player-1 (2) + player-2 (1) + family (1) = 4 new Open non-deleted chores
    expect(count).toBe(4);
  });
});

describe("countNewByTimestamp / countNewChangelog", () => {
  it("counts timestamps after lastSeen", () => {
    expect(
      countNewByTimestamp(["2026-06-02T00:00:00.000Z", "2026-05-01T00:00:00.000Z"], "2026-06-01T00:00:00.000Z"),
    ).toBe(1);
  });
  it("counts changelog entries by day after the last-seen day", () => {
    expect(
      countNewChangelog({
        entryDates: ["2026-06-06", "2026-06-05", "2026-06-01"],
        lastSeenAt: "2026-06-05T10:00:00.000Z",
      }),
    ).toBe(1); // only 2026-06-06 is after the 2026-06-05 day
  });
  it("counts all changelog entries when never seen", () => {
    expect(countNewChangelog({ entryDates: ["2026-06-06", "2026-06-05"], lastSeenAt: null })).toBe(2);
  });
});

describe("countNewCompletedAchievements", () => {
  const lastSeen = "2026-06-01T00:00:00.000Z";
  const achievements = [
    { audience: "player" as const, completed: true, completedAt: "2026-06-02T00:00:00.000Z" },
    { audience: "player" as const, completed: true, completedAt: "2026-05-01T00:00:00.000Z" },
    { audience: "player" as const, completed: false, completedAt: "2026-06-02T00:00:00.000Z" },
    { audience: "admin" as const, completed: true, completedAt: "2026-06-02T00:00:00.000Z" },
  ];

  it("counts only the player's newly completed player achievements", () => {
    expect(
      countNewCompletedAchievements({ achievements, viewerRole: "player", lastSeenAt: lastSeen }),
    ).toBe(1);
  });

  it("includes admin-audience achievements for admins", () => {
    expect(
      countNewCompletedAchievements({ achievements, viewerRole: "admin", lastSeenAt: lastSeen }),
    ).toBe(2);
  });
});

describe("section validation and role visibility", () => {
  it("rejects unknown sections", () => {
    expect(normalizeDiscoverySection("not_a_section")).toBeNull();
    expect(normalizeDiscoverySection("chores")).toBe("chores");
    expect(normalizeDiscoverySection("store:customize_avatar")).toBe("store:customize_avatar");
  });

  it("hides community awards (parent-only) from players", () => {
    expect(canViewerSeeSection("community_awards", "player")).toBe(false);
    expect(canViewerSeeSection("community_awards", "admin")).toBe(true);
  });

  it("excludes admin-only sections from the player section list", () => {
    const playerKeys = listSectionsForRole("player").map((s) => s.key);
    expect(playerKeys).not.toContain("community_awards");
    expect(playerKeys).toContain("chores");
    expect(playerKeys).toContain("store:customize_avatar");
  });
});
