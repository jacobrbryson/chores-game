import { describe, expect, it } from "vitest";
import { buildGhostChoreRequest, deriveAge } from "@/lib/ghost-chore-context";

describe("deriveAge", () => {
  it("derives an approximate age from a birth year", () => {
    expect(deriveAge(2016, new Date("2026-06-18T00:00:00Z"))).toBe(10);
  });
  it("returns undefined for missing/implausible values", () => {
    expect(deriveAge(undefined)).toBeUndefined();
    expect(deriveAge(0)).toBeUndefined();
    expect(deriveAge(3000, new Date("2026-06-18T00:00:00Z"))).toBeUndefined();
  });
});

describe("buildGhostChoreRequest", () => {
  const base = {
    subject: { id: "m1", role: "player" as const, displayName: "Sam", birthYear: 2016 },
    startedAt: "2026-01-01T00:00:00Z",
    totalChoresCompleted: 12,
    coinBalance: 40,
    activeChores: [{ title: "Make bed", coinValue: 5, category: "Home" }],
    recentlyCompleted: [{ title: "Brush teeth" }],
    pastChores: [{ title: "Old chore" }],
    suggestionActivity: { suggested: [{ title: "S" }], dismissed: [{ title: "D" }], accepted: [{ title: "A" }] },
    categories: ["Home", "Self Care", "Home"],
    familySettings: { requireApproval: true },
    now: new Date("2026-06-18T00:00:00Z"),
  };

  it("assembles a minimized, age-aware payload", () => {
    const req = buildGhostChoreRequest(base);
    expect(req.user).toEqual({ id: "m1", role: "player", displayName: "Sam", birthYear: 2016, age: 10 });
    expect(req.tenureDays).toBeGreaterThan(150);
    expect(req.totalChoresCompleted).toBe(12);
    expect(req.coinBalance).toBe(40);
    expect(req.activeChores).toEqual([{ title: "Make bed", coinValue: 5, category: "Home" }]);
    expect(req.familySettings.requireApproval).toBe(true);
  });

  it("dedupes categories and never emits PII fields", () => {
    const req = buildGhostChoreRequest(base);
    expect(req.categories).toEqual(["Home", "Self Care"]);
    // Only the documented keys are present on user — no email/uid leakage.
    expect(Object.keys(req.user).sort()).toEqual(["age", "birthYear", "displayName", "id", "role"]);
  });

  it("omits age/birthYear when no birth year is known", () => {
    const req = buildGhostChoreRequest({ ...base, subject: { id: "m2", role: "player" } });
    expect(req.user).toEqual({ id: "m2", role: "player" });
  });

  it("dedupes chores by title key", () => {
    const req = buildGhostChoreRequest({
      ...base,
      activeChores: [{ title: "Make Bed" }, { title: "make bed!" }, { title: "Sweep" }],
    });
    expect(req.activeChores).toHaveLength(2);
  });
});
