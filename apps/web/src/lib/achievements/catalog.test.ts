import { describe, expect, it } from "vitest";
import { ACHIEVEMENT_CATALOG } from "@/lib/achievements/catalog";

describe("achievement catalog", () => {
  it("has 56 unique active achievements with 46 player and 10 admin", () => {
    expect(ACHIEVEMENT_CATALOG).toHaveLength(56);
    const ids = new Set(ACHIEVEMENT_CATALOG.map((entry) => entry.id));
    expect(ids.size).toBe(56);
    expect(ACHIEVEMENT_CATALOG.filter((entry) => entry.audience === "player")).toHaveLength(46);
    expect(ACHIEVEMENT_CATALOG.filter((entry) => entry.audience === "admin")).toHaveLength(10);
  });
});
