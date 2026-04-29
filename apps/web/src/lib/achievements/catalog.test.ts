import { describe, expect, it } from "vitest";
import { ACHIEVEMENT_CATALOG } from "@/lib/achievements/catalog";

describe("achievement catalog", () => {
  it("has 50 unique achievements with 40 player and 10 admin", () => {
    expect(ACHIEVEMENT_CATALOG).toHaveLength(50);
    const ids = new Set(ACHIEVEMENT_CATALOG.map((entry) => entry.id));
    expect(ids.size).toBe(50);
    expect(ACHIEVEMENT_CATALOG.filter((entry) => entry.audience === "player")).toHaveLength(40);
    expect(ACHIEVEMENT_CATALOG.filter((entry) => entry.audience === "admin")).toHaveLength(10);
  });
});
