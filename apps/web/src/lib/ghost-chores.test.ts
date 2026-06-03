import { describe, expect, it } from "vitest";
import {
  buildGhostCandidatePool,
  generateGhostSuggestions,
  ghostSuggestionId,
  ghostSuggestionKey,
  isSafeChoreTitle,
  resolveGhostSuggestion,
  summarizeGhostSuggestions,
  type GhostChoreSuggestionRecord,
} from "@/lib/ghost-chores";

function record(patch: Partial<GhostChoreSuggestionRecord>): GhostChoreSuggestionRecord {
  return {
    id: "builtin_template__make-your-bed",
    familyId: "family-1",
    playerUid: "uid-1",
    playerMemberId: "member-1",
    suggestedTitle: "Make your bed",
    suggestedDescription: "Tidy up.",
    suggestedCoinValue: 5,
    suggestedCategoryIds: [],
    source: "builtin_template",
    status: "requested",
    requestedAt: "2026-06-02T00:00:00.000Z",
    requestedByUid: "uid-1",
    reviewedAt: "",
    reviewedByUid: "",
    convertedChoreId: "",
    dismissedAt: "",
    upvotes: 0,
    downvotes: 0,
    createdAt: "2026-06-02T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z",
    ...patch,
  };
}

describe("ghost chore safety", () => {
  it("rejects unsafe chores (chemicals, heat, sharp tools, heights, power tools, outdoor hazards, pet care)", () => {
    expect(isSafeChoreTitle("Clean the oven with bleach")).toBe(false);
    expect(isSafeChoreTitle("Chop vegetables with a knife")).toBe(false);
    expect(isSafeChoreTitle("Mow the lawn")).toBe(false);
    expect(isSafeChoreTitle("Clean the gutter on the ladder")).toBe(false);
    expect(isSafeChoreTitle("Use the drill to hang a shelf")).toBe(false);
    expect(isSafeChoreTitle("Walk the dog by the pool")).toBe(false);
    expect(isSafeChoreTitle("Clean the litter box")).toBe(false);
  });

  it("allows safe indoor tidy-up chores", () => {
    expect(isSafeChoreTitle("Make your bed")).toBe(true);
    expect(isSafeChoreTitle("Tidy your room")).toBe(true);
    expect(isSafeChoreTitle("Set the table")).toBe(true);
  });

  it("never includes unsafe family chores in the candidate pool", () => {
    const pool = buildGhostCandidatePool([
      { title: "Chop the firewood with an axe", coinValue: 50 },
      { title: "Feed the goldfish", coinValue: 5 },
    ]);
    const titles = pool.map((entry) => entry.suggestedTitle);
    expect(titles).not.toContain("Chop the firewood with an axe");
    expect(titles).toContain("Feed the goldfish");
  });
});

describe("ghost chore generation", () => {
  it("returns deterministic, family-first suggestions and respects the limit", () => {
    const suggestions = generateGhostSuggestions({
      familyChores: [{ title: "Tidy the playroom", coinValue: 8 }],
      limit: 3,
    });
    expect(suggestions).toHaveLength(3);
    expect(suggestions[0].suggestedTitle).toBe("Tidy the playroom");
    expect(suggestions[0].source).toBe("recent_chore");
    // remaining slots filled from built-in templates
    expect(suggestions[1].source).toBe("builtin_template");
  });

  it("excludes dismissed / requested / open chore keys", () => {
    const suggestions = generateGhostSuggestions({
      excludeKeys: [ghostSuggestionKey("Make your bed")],
      limit: 20,
    });
    expect(suggestions.map((entry) => entry.suggestedTitle)).not.toContain("Make your bed");
  });

  it("deduplicates a family chore that matches a built-in template by title", () => {
    const pool = buildGhostCandidatePool([{ title: "make your bed", coinValue: 9 }]);
    const matching = pool.filter((entry) => ghostSuggestionKey(entry.suggestedTitle) === ghostSuggestionKey("Make your bed"));
    expect(matching).toHaveLength(1);
    expect(matching[0].source).toBe("recent_chore");
  });

  it("resolves a suggestion by its deterministic id", () => {
    const id = ghostSuggestionId("builtin_template", "Make your bed");
    const resolved = resolveGhostSuggestion(id);
    expect(resolved?.suggestedTitle).toBe("Make your bed");
    expect(resolveGhostSuggestion("builtin_template__does-not-exist")).toBeNull();
  });
});

describe("ghost chore support summary", () => {
  it("aggregates lifecycle counts and top requested templates", () => {
    const summary = summarizeGhostSuggestions([
      record({ status: "requested", suggestedTitle: "Tidy your room" }),
      record({ status: "requested", suggestedTitle: "Tidy your room" }),
      record({ status: "converted", suggestedTitle: "Make your bed" }),
      record({ status: "dismissed", suggestedTitle: "Set the table" }),
      record({ status: "rejected", suggestedTitle: "Water the plants" }),
    ]);
    expect(summary.totalRecords).toBe(5);
    expect(summary.requested).toBe(2);
    expect(summary.dismissed).toBe(1);
    expect(summary.rejected).toBe(1);
    expect(summary.converted).toBe(1);
    expect(summary.approved).toBe(1);
    expect(summary.pendingReview).toBe(2);
    expect(summary.topTemplates[0]).toEqual({ title: "Tidy your room", count: 2 });
  });
});
