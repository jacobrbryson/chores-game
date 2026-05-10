import { describe, expect, it } from "vitest";
import { AchievementProgressSchema, ChoreSchema, RoleSchema } from "./index";

describe("api contracts", () => {
  it("parses chore schema", () => {
    const parsed = ChoreSchema.parse({ id: "c1", title: "Take out trash", status: "Open", coinValue: 5, requireApproval: true });
    expect(parsed.title).toBe("Take out trash");
  });

  it("parses role enum", () => {
    expect(RoleSchema.parse("admin")).toBe("admin");
  });

  it("parses achievement progress", () => {
    const parsed = AchievementProgressSchema.parse({ achievementId: "a1", title: "Starter", percent: 50, completed: false });
    expect(parsed.percent).toBe(50);
  });
});
