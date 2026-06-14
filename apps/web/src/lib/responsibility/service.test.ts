import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateOrReplaceDocument = vi.fn();
const mockGetDocument = vi.fn();

vi.mock("@/lib/firestore/rest", () => ({
  createOrReplaceDocument: (...args: unknown[]) => mockCreateOrReplaceDocument(...args),
  getDocument: (...args: unknown[]) => mockGetDocument(...args),
  stringField: (value: string) => ({ stringValue: value }),
  integerField: (value: number) => ({ integerValue: String(value) }),
  timestampField: (value: string) => ({ timestampValue: value }),
  readString: (fields: Record<string, unknown> | undefined, key: string) => {
    const value = fields?.[key];
    if (value && typeof value === "object" && "stringValue" in value) {
      return (value as { stringValue: string }).stringValue;
    }
    return "";
  },
  readInteger: (fields: Record<string, unknown> | undefined, key: string) => {
    const value = fields?.[key];
    if (value && typeof value === "object" && "integerValue" in value) {
      return Number((value as { integerValue: string }).integerValue);
    }
    return 0;
  },
  readTimestamp: (fields: Record<string, unknown> | undefined, key: string) => {
    const value = fields?.[key];
    if (value && typeof value === "object" && "timestampValue" in value) {
      return (value as { timestampValue: string }).timestampValue;
    }
    return "";
  },
}));

vi.mock("@/lib/responsibility/config", async () => {
  const actualLevels = await import("@/lib/responsibility/levels");
  return {
    loadResponsibilityConfig: vi.fn(async () => ({
      xpValues: {
        choreCompletionXp: 5,
        routineStepXp: 5,
        routineCompletionBonusXp: 15,
        newSkillBonusXp: 10,
      },
      levelThresholds: actualLevels.DEFAULT_LEVEL_THRESHOLDS,
    })),
  };
});

import {
  awardChoreResponsibilityXpBestEffort,
  getResponsibilityProgress,
  mostCompletedRoutineFromStats,
  parseRoutineCompletionsJson,
  pillarXpFieldName,
  recordResponsibilityXpAward,
  recordRoutineCompletionStatsBestEffort,
} from "./service";

function notFoundError() {
  return new Error("FIRESTORE_HTTP_404_Document not found");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recordResponsibilityXpAward", () => {
  it("writes an immutable event and folds XP into a fresh aggregate", async () => {
    mockGetDocument.mockRejectedValueOnce(notFoundError());
    await recordResponsibilityXpAward({
      familyId: "fam-1",
      idToken: "token",
      award: {
        playerId: "kid-1",
        pillar: "home_care",
        xpAwarded: 5,
        eventType: "chore_completed",
        choreId: "chore-1",
      },
    });
    expect(mockCreateOrReplaceDocument).toHaveBeenCalledTimes(2);
    const [eventPath, eventFields] = mockCreateOrReplaceDocument.mock.calls[0];
    expect(eventPath).toMatch(/^families\/fam-1\/responsibilityXpEvents\//);
    expect(eventFields.pillar).toEqual({ stringValue: "home_care" });
    expect(eventFields.xpAwarded).toEqual({ integerValue: "5" });
    const [progressPath, progressFields] = mockCreateOrReplaceDocument.mock.calls[1];
    expect(progressPath).toBe("families/fam-1/responsibilityProgress/kid-1");
    expect(progressFields[pillarXpFieldName("home_care")]).toEqual({ integerValue: "5" });
    expect(progressFields.totalXp).toEqual({ integerValue: "5" });
    expect(progressFields.skillsLearned).toEqual({ integerValue: "0" });
  });

  it("adds to existing pillar XP without touching other pillars", async () => {
    mockGetDocument.mockResolvedValueOnce({
      fields: {
        xp_home_care: { integerValue: "40" },
        xp_self_care: { integerValue: "7" },
        totalXp: { integerValue: "47" },
        skillsLearned: { integerValue: "2" },
        routinesCompleted: { integerValue: "1" },
      },
    });
    await recordResponsibilityXpAward({
      familyId: "fam-1",
      idToken: "token",
      award: {
        playerId: "kid-1",
        pillar: "home_care",
        xpAwarded: 10,
        eventType: "new_skill_bonus",
      },
    });
    const [, progressFields] = mockCreateOrReplaceDocument.mock.calls[1];
    expect(progressFields.xp_home_care).toEqual({ integerValue: "50" });
    expect(progressFields.xp_self_care).toEqual({ integerValue: "7" });
    expect(progressFields.totalXp).toEqual({ integerValue: "57" });
    expect(progressFields.skillsLearned).toEqual({ integerValue: "3" });
    expect(progressFields.routinesCompleted).toEqual({ integerValue: "1" });
  });

  it("does not bump routine completion counters from the XP path", async () => {
    // Routine completions are counted by recordRoutineCompletionStatsBestEffort
    // (even pillar-less routines count); the XP fold must carry the existing
    // counter through unchanged.
    mockGetDocument.mockResolvedValueOnce({
      fields: { routinesCompleted: { integerValue: "4" } },
    });
    await recordResponsibilityXpAward({
      familyId: "fam-1",
      idToken: "token",
      award: {
        playerId: "kid-1",
        pillar: "life_skills",
        xpAwarded: 15,
        eventType: "routine_completed",
        routineId: "routine-1",
      },
    });
    const [, progressFields] = mockCreateOrReplaceDocument.mock.calls[1];
    expect(progressFields.routinesCompleted).toEqual({ integerValue: "4" });
  });

  it("counts routine completions and tracks the most completed routine", async () => {
    mockGetDocument.mockResolvedValueOnce({
      fields: {
        routinesCompleted: { integerValue: "2" },
        routineCompletionsJson: {
          stringValue: JSON.stringify({ "routine-9": { name: "Laundry Day", count: 2 } }),
        },
      },
    });
    await recordRoutineCompletionStatsBestEffort({
      familyId: "fam-1",
      idToken: "token",
      playerId: "kid-1",
      routineId: "routine-1",
      routineName: "Clean Room",
    });
    const [progressPath, progressFields] = mockCreateOrReplaceDocument.mock.calls[0];
    expect(progressPath).toBe("families/fam-1/responsibilityProgress/kid-1");
    expect(progressFields.routinesCompleted).toEqual({ integerValue: "3" });
    const stats = parseRoutineCompletionsJson(progressFields.routineCompletionsJson.stringValue);
    expect(stats["routine-1"]).toEqual({ name: "Clean Room", count: 1 });
    expect(stats["routine-9"]).toEqual({ name: "Laundry Day", count: 2 });
    expect(mostCompletedRoutineFromStats(stats)).toEqual({
      routineId: "routine-9",
      name: "Laundry Day",
      count: 2,
    });
  });

  it("ignores zero/negative awards and missing identifiers", async () => {
    await recordResponsibilityXpAward({
      familyId: "fam-1",
      idToken: "token",
      award: { playerId: "kid-1", pillar: "home_care", xpAwarded: 0, eventType: "chore_completed" },
    });
    await recordResponsibilityXpAward({
      familyId: "",
      idToken: "token",
      award: { playerId: "kid-1", pillar: "home_care", xpAwarded: 5, eventType: "chore_completed" },
    });
    expect(mockCreateOrReplaceDocument).not.toHaveBeenCalled();
  });
});

describe("awardChoreResponsibilityXpBestEffort", () => {
  it("awards nothing for a chore with no pillar (existing chores keep working)", async () => {
    const outcome = await awardChoreResponsibilityXpBestEffort({
      familyId: "fam-1",
      idToken: "token",
      choreId: "chore-1",
      choreFields: {},
      paidPlayerUids: ["kid-1"],
      newSkillPlayerUids: ["kid-1"],
    });
    expect(outcome).toEqual({ pillar: "", choreXpAwarded: 0, newSkillXpAwarded: 0 });
    expect(mockCreateOrReplaceDocument).not.toHaveBeenCalled();
  });

  it("awards chore XP per paid player plus new-skill XP per bonus winner", async () => {
    mockGetDocument.mockRejectedValue(notFoundError());
    const outcome = await awardChoreResponsibilityXpBestEffort({
      familyId: "fam-1",
      idToken: "token",
      choreId: "chore-1",
      choreFields: { responsibilityPillar: { stringValue: "home_care" } },
      paidPlayerUids: ["kid-1", "kid-2", "kid-1"],
      newSkillPlayerUids: ["kid-1"],
    });
    expect(outcome.pillar).toBe("home_care");
    expect(outcome.choreXpAwarded).toBe(10); // 5 XP × 2 distinct players
    expect(outcome.newSkillXpAwarded).toBe(10);
    // 3 awards → 3 events + 3 aggregate writes
    expect(mockCreateOrReplaceDocument).toHaveBeenCalledTimes(6);
  });

  it("honors a per-chore XP override", async () => {
    mockGetDocument.mockRejectedValue(notFoundError());
    const outcome = await awardChoreResponsibilityXpBestEffort({
      familyId: "fam-1",
      idToken: "token",
      choreId: "chore-1",
      choreFields: {
        responsibilityPillar: { stringValue: "organization" },
        responsibilityXpReward: { integerValue: "25" },
      },
      paidPlayerUids: ["kid-1"],
      newSkillPlayerUids: [],
    });
    expect(outcome.choreXpAwarded).toBe(25);
  });

  it("swallows Firestore failures (XP must never break completion)", async () => {
    mockGetDocument.mockRejectedValue(notFoundError());
    mockCreateOrReplaceDocument.mockRejectedValue(new Error("FIRESTORE_HTTP_500"));
    const outcome = await awardChoreResponsibilityXpBestEffort({
      familyId: "fam-1",
      idToken: "token",
      choreId: "chore-1",
      choreFields: { responsibilityPillar: { stringValue: "home_care" } },
      paidPlayerUids: ["kid-1"],
      newSkillPlayerUids: ["kid-1"],
    });
    expect(outcome.choreXpAwarded).toBe(0);
    expect(outcome.newSkillXpAwarded).toBe(0);
  });
});

describe("getResponsibilityProgress", () => {
  it("returns zeroed level-1 progress when no aggregate exists", async () => {
    mockGetDocument.mockRejectedValueOnce(notFoundError());
    const progress = await getResponsibilityProgress({
      familyId: "fam-1",
      playerUid: "kid-1",
      idToken: "token",
    });
    expect(progress.totalXp).toBe(0);
    expect(progress.mostActivePillar).toBe("");
    expect(progress.pillars).toHaveLength(5);
    expect(progress.pillars.every((entry) => entry.level === 1)).toBe(true);
  });

  it("derives levels and the most active pillar from stored XP", async () => {
    mockGetDocument.mockResolvedValueOnce({
      fields: {
        xp_home_care: { integerValue: "840" },
        xp_self_care: { integerValue: "510" },
        xp_organization: { integerValue: "220" },
        xp_family_contribution: { integerValue: "460" },
        xp_life_skills: { integerValue: "180" },
        totalXp: { integerValue: "2210" },
        skillsLearned: { integerValue: "12" },
        routinesCompleted: { integerValue: "4" },
      },
    });
    const progress = await getResponsibilityProgress({
      familyId: "fam-1",
      playerUid: "kid-1",
      idToken: "token",
    });
    expect(progress.mostActivePillar).toBe("home_care");
    const byPillar = Object.fromEntries(progress.pillars.map((entry) => [entry.pillar, entry]));
    expect(byPillar.home_care.level).toBe(4); // 840 ≥ 500, < 900
    expect(byPillar.self_care.level).toBe(4);
    expect(byPillar.organization.level).toBe(2);
    expect(byPillar.life_skills.level).toBe(2);
    expect(progress.skillsLearned).toBe(12);
    expect(progress.routinesCompleted).toBe(4);
  });
});
