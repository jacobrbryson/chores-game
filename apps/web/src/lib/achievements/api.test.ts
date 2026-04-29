import { describe, expect, it } from "vitest";
import { readAchievementHighlightId } from "@/lib/achievements/api";

describe("achievement highlight helper", () => {
  it("prefers query highlight id over hash id", () => {
    expect(readAchievementHighlightId("highlight=player_first_chore", "#admin_first_approval")).toBe(
      "player_first_chore",
    );
  });

  it("falls back to hash id when query is missing", () => {
    expect(readAchievementHighlightId("", "#player_first_purchase")).toBe("player_first_purchase");
  });
});
