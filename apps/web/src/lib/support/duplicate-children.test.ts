import { describe, expect, it } from "vitest";
import {
  findDuplicateChildGroups,
  hasMeaningfulActivity,
  normalizeChildName,
  type ChildRecord,
} from "@/lib/support/duplicate-children";

const EMPTY_ACTIVITY = {
  choreCount: 0,
  completedChoreCount: 0,
  coinBalance: 0,
  walletEntryCount: 0,
  inventoryCount: 0,
  achievementCount: 0,
};

function child(overrides: Partial<ChildRecord>): ChildRecord {
  return {
    familyId: "fam1",
    memberId: "m1",
    name: "Sam",
    role: "player",
    deleted: false,
    createdAt: "2026-06-01T00:00:00Z",
    activity: { ...EMPTY_ACTIVITY },
    ...overrides,
  };
}

describe("normalizeChildName", () => {
  it("trims, collapses whitespace, and lowercases", () => {
    expect(normalizeChildName("  Sam   Smith ")).toBe("sam smith");
    expect(normalizeChildName("SAM")).toBe("sam");
  });
});

describe("hasMeaningfulActivity", () => {
  it("treats unknown activity as meaningful (never auto-deletes uninspected children)", () => {
    expect(hasMeaningfulActivity(undefined)).toBe(true);
  });
  it("is false for a fully empty child", () => {
    expect(hasMeaningfulActivity({ ...EMPTY_ACTIVITY })).toBe(false);
  });
  it("is true when any linked activity exists", () => {
    expect(hasMeaningfulActivity({ ...EMPTY_ACTIVITY, coinBalance: 5 })).toBe(true);
    expect(hasMeaningfulActivity({ ...EMPTY_ACTIVITY, completedChoreCount: 1 })).toBe(true);
    expect(hasMeaningfulActivity({ ...EMPTY_ACTIVITY, achievementCount: 1 })).toBe(true);
  });
});

describe("findDuplicateChildGroups", () => {
  it("groups same-family same-name players and flags the earliest as original", () => {
    const groups = findDuplicateChildGroups([
      child({ memberId: "older", createdAt: "2026-06-01T00:00:00Z" }),
      child({ memberId: "newer", createdAt: "2026-06-05T00:00:00Z", name: "sam " }),
    ]);
    expect(groups).toHaveLength(1);
    const [group] = groups;
    const original = group.candidates.find((c) => c.isOriginal);
    const duplicate = group.candidates.find((c) => !c.isOriginal);
    expect(original?.memberId).toBe("older");
    expect(duplicate?.memberId).toBe("newer");
    expect(duplicate?.safeToDelete).toBe(true);
    expect(original?.safeToDelete).toBe(false);
  });

  it("does not flag the original as safe to delete, only empty non-originals", () => {
    const groups = findDuplicateChildGroups([
      child({ memberId: "a", createdAt: "2026-06-01T00:00:00Z" }),
      child({ memberId: "b", createdAt: "2026-06-02T00:00:00Z" }),
    ]);
    const safe = groups[0].candidates.filter((c) => c.safeToDelete);
    expect(safe.map((c) => c.memberId)).toEqual(["b"]);
  });

  it("never marks a duplicate with activity as safe to delete", () => {
    const groups = findDuplicateChildGroups([
      child({ memberId: "a", createdAt: "2026-06-01T00:00:00Z" }),
      child({
        memberId: "b",
        createdAt: "2026-06-02T00:00:00Z",
        activity: { ...EMPTY_ACTIVITY, coinBalance: 10 },
      }),
    ]);
    const b = groups[0].candidates.find((c) => c.memberId === "b");
    expect(b?.hasMeaningfulActivity).toBe(true);
    expect(b?.safeToDelete).toBe(false);
  });

  it("ignores singletons, deleted records, and non-players", () => {
    const groups = findDuplicateChildGroups([
      child({ memberId: "solo", name: "Unique" }),
      child({ memberId: "del", name: "Sam", deleted: true }),
      child({ memberId: "live", name: "Sam" }),
      child({ memberId: "admin", name: "Sam", role: "admin" }),
    ]);
    // Only one live "Sam" player remains → no group of 2.
    expect(groups).toHaveLength(0);
  });

  it("does not merge children across families", () => {
    const groups = findDuplicateChildGroups([
      child({ familyId: "fam1", memberId: "a", name: "Sam" }),
      child({ familyId: "fam2", memberId: "b", name: "Sam" }),
    ]);
    expect(groups).toHaveLength(0);
  });

  it("marks duplicates created after family consent (TOS) timestamp", () => {
    const groups = findDuplicateChildGroups([
      child({ memberId: "a", createdAt: "2026-06-01T00:00:00Z", familyConsentAt: "2026-06-03T00:00:00Z" }),
      child({ memberId: "b", createdAt: "2026-06-05T00:00:00Z", familyConsentAt: "2026-06-03T00:00:00Z" }),
    ]);
    const b = groups[0].candidates.find((c) => c.memberId === "b");
    expect(b?.createdAfterFamilyConsent).toBe(true);
  });
});
