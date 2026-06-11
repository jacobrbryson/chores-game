import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCommitWrites = vi.fn();
const mockGetDocument = vi.fn();
const mockListAllDocuments = vi.fn();

vi.mock("@/lib/firestore/rest", () => ({
  commitWrites: (...args: unknown[]) => mockCommitWrites(...args),
  getDocument: (...args: unknown[]) => mockGetDocument(...args),
  listAllDocuments: (...args: unknown[]) => mockListAllDocuments(...args),
  readBoolean: (fields: Record<string, unknown> | undefined, key: string) =>
    Boolean(fields?.[key]),
  readString: (fields: Record<string, unknown> | undefined, key: string) => {
    const value = fields?.[key];
    if (value && typeof value === "object" && "stringValue" in value) {
      return (value as { stringValue: string }).stringValue;
    }
    return typeof value === "string" ? value : "";
  },
  stringField: (value: string) => ({ stringValue: value }),
  timestampField: (value: string) => ({ timestampValue: value }),
}));

import {
  canonicalRecurringChoreId,
  claimNewSkillBonus,
  hasClaimedSkillBonus,
  loadClaimedSkillBonusKeys,
  NEW_SKILL_BONUS_AMOUNT,
  skillBonusEligibilityKey,
} from "./skill-bonus";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("canonicalRecurringChoreId", () => {
  it("uses the chore id itself for a non-recurring chore", () => {
    expect(canonicalRecurringChoreId({}, "chore-1")).toBe("chore-1");
  });

  it("prefers the recurrence root id when present", () => {
    expect(
      canonicalRecurringChoreId(
        {
          recurrenceRootChoreId: { stringValue: "root-1" },
          recurrenceParentChoreId: { stringValue: "parent-1" },
        },
        "chore-3",
      ),
    ).toBe("root-1");
  });

  it("falls back to the parent id when no root id exists", () => {
    expect(
      canonicalRecurringChoreId(
        { recurrenceParentChoreId: { stringValue: "parent-1" } },
        "chore-2",
      ),
    ).toBe("parent-1");
  });
});

describe("claimNewSkillBonus", () => {
  const base = {
    familyId: "family-1",
    playerUid: "player-1",
    rootChoreId: "root-1",
    sourceCompletionId: "chore-9",
    idToken: "token",
  };

  it("returns firstTime when the claim record is newly created", async () => {
    mockCommitWrites.mockResolvedValueOnce(undefined);
    const result = await claimNewSkillBonus(base);
    expect(result.firstTime).toBe(true);
    expect(mockCommitWrites).toHaveBeenCalledTimes(1);
    const [writes] = mockCommitWrites.mock.calls[0];
    expect(writes[0].update.currentDocument).toEqual({ exists: false });
    expect(writes[0].update.path).toBe(
      "families/family-1/skillBonuses/player-1__root-1",
    );
  });

  it("does not award again when the claim already exists", async () => {
    mockCommitWrites.mockRejectedValueOnce(new Error("FIRESTORE_HTTP_409_ALREADY_EXISTS"));
    const result = await claimNewSkillBonus(base);
    expect(result.firstTime).toBe(false);
  });

  it("treats a failed precondition as already claimed (concurrent writer)", async () => {
    mockCommitWrites.mockRejectedValueOnce(
      new Error("FIRESTORE_HTTP_400_FAILED_PRECONDITION"),
    );
    const result = await claimNewSkillBonus(base);
    expect(result.firstTime).toBe(false);
  });

  it("skips the award (firstTime false) on unexpected errors rather than double-paying", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockCommitWrites.mockRejectedValueOnce(new Error("FIRESTORE_HTTP_500"));
    const result = await claimNewSkillBonus(base);
    expect(result.firstTime).toBe(false);
  });

  it("never claims when required identifiers are missing", async () => {
    const result = await claimNewSkillBonus({ ...base, rootChoreId: "" });
    expect(result.firstTime).toBe(false);
    expect(mockCommitWrites).not.toHaveBeenCalled();
  });
});

describe("hasClaimedSkillBonus", () => {
  it("returns false when the claim record does not exist", async () => {
    mockGetDocument.mockRejectedValueOnce(new Error("FIRESTORE_HTTP_404"));
    const claimed = await hasClaimedSkillBonus({
      familyId: "family-1",
      playerUid: "player-1",
      rootChoreId: "root-1",
      idToken: "token",
    });
    expect(claimed).toBe(false);
  });

  it("returns true when the claim record exists", async () => {
    mockGetDocument.mockResolvedValueOnce({ fields: {} });
    const claimed = await hasClaimedSkillBonus({
      familyId: "family-1",
      playerUid: "player-1",
      rootChoreId: "root-1",
      idToken: "token",
    });
    expect(claimed).toBe(true);
  });
});

describe("loadClaimedSkillBonusKeys", () => {
  it("builds a set of player/root eligibility keys", async () => {
    mockListAllDocuments.mockResolvedValueOnce([
      {
        name: "families/family-1/skillBonuses/player-1__root-1",
        fields: { playerId: "player-1", rootChoreId: "root-1" },
      },
      {
        name: "families/family-1/skillBonuses/player-2__root-1",
        fields: { playerId: "player-2", rootChoreId: "root-1" },
      },
    ]);
    const keys = await loadClaimedSkillBonusKeys("family-1", "token");
    expect(keys.has(skillBonusEligibilityKey("player-1", "root-1"))).toBe(true);
    expect(keys.has(skillBonusEligibilityKey("player-2", "root-1"))).toBe(true);
    expect(keys.has(skillBonusEligibilityKey("player-3", "root-1"))).toBe(false);
  });
});

describe("NEW_SKILL_BONUS_AMOUNT", () => {
  it("is +5 coins", () => {
    expect(NEW_SKILL_BONUS_AMOUNT).toBe(5);
  });
});
