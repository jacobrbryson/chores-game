import { describe, expect, it } from "vitest";
import { ACHIEVEMENT_CATALOG } from "@/lib/achievements/catalog";

describe("achievement catalog", () => {
  it("has 58 unique achievements with 48 player and 10 admin", () => {
    expect(ACHIEVEMENT_CATALOG).toHaveLength(58);
    const ids = new Set(ACHIEVEMENT_CATALOG.map((entry) => entry.id));
    expect(ids.size).toBe(58);
    expect(ACHIEVEMENT_CATALOG.filter((entry) => entry.audience === "player")).toHaveLength(48);
    expect(ACHIEVEMENT_CATALOG.filter((entry) => entry.audience === "admin")).toHaveLength(10);
  });
});
