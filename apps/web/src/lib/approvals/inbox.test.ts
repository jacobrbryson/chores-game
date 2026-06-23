import { describe, expect, it } from "vitest";
import {
  FAMILY_GROUP_KEY,
  groupApprovalsByChild,
  resolveApprovalChoreType,
  splitForApproveAll,
  summarizeApprovals,
  type ApprovalChore,
  type AssigneeDirectoryEntry,
} from "./inbox";

function chore(overrides: Partial<ApprovalChore> & { id: string }): ApprovalChore {
  return {
    title: "Chore",
    status: "Submitted",
    requireApproval: true,
    assigneeName: "Child",
    coinValue: 10,
    ...overrides,
  };
}

const directory: AssigneeDirectoryEntry[] = [
  { id: "thomas", name: "Thomas", avatarId: "a1" },
  { id: "helena", name: "Helena", avatarId: "a2" },
];

describe("groupApprovalsByChild", () => {
  it("groups awaiting-approval chores by their primary assignee, in first-seen order", () => {
    const groups = groupApprovalsByChild(
      [
        chore({ id: "1", assigneeId: "thomas", title: "Walk Dog" }),
        chore({ id: "2", assigneeId: "helena", title: "Feed Cat" }),
        chore({ id: "3", assigneeId: "thomas", title: "Trash" }),
      ],
      directory,
      "Family",
    );
    expect(groups.map((group) => group.key)).toEqual(["thomas", "helena"]);
    expect(groups[0].name).toBe("Thomas");
    expect(groups[0].chores.map((entry) => entry.id)).toEqual(["1", "3"]);
    expect(groups[1].chores.map((entry) => entry.id)).toEqual(["2"]);
  });

  it("excludes chores that are not awaiting approval", () => {
    const groups = groupApprovalsByChild(
      [
        chore({ id: "1", assigneeId: "thomas" }),
        chore({ id: "2", assigneeId: "thomas", status: "Open" }),
        chore({ id: "3", assigneeId: "thomas", requireApproval: false }),
      ],
      directory,
      "Family",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].chores.map((entry) => entry.id)).toEqual(["1"]);
  });

  it("collapses family-scope chores into a single Family bucket", () => {
    const groups = groupApprovalsByChild(
      [chore({ id: "1", assigneeScope: "family", assigneeName: "Family" })],
      directory,
      "Family",
    );
    expect(groups[0].key).toBe(FAMILY_GROUP_KEY);
    expect(groups[0].isFamily).toBe(true);
    expect(groups[0].name).toBe("Family");
  });

  it("falls back to the first assignee id and chore name when not in the directory", () => {
    const groups = groupApprovalsByChild(
      [chore({ id: "1", assigneeIds: ["ghost"], assigneeName: "Ghost Kid" })],
      directory,
      "Family",
    );
    expect(groups[0].key).toBe("ghost");
    expect(groups[0].name).toBe("Ghost Kid");
  });
});

describe("splitForApproveAll", () => {
  it("separates predefined-value chores from those needing a coin value", () => {
    const { immediate, needsCoins } = splitForApproveAll([
      chore({ id: "standard", assigneeId: "thomas", coinValue: 10 }),
      chore({ id: "seeAndDo", assigneeId: "thomas", choreType: "see_and_do", coinValue: 0 }),
      chore({ id: "family", assigneeScope: "family", coinValue: 20 }),
      chore({ id: "multi", assigneeIds: ["thomas", "helena"], coinValue: 20 }),
    ]);
    expect(immediate.map((entry) => entry.id)).toEqual(["standard"]);
    expect(needsCoins.map((entry) => entry.id).sort()).toEqual(["family", "multi", "seeAndDo"]);
  });

  it("treats a See & Do chore with a predefined value as immediate", () => {
    const { immediate, needsCoins } = splitForApproveAll([
      chore({ id: "seeAndDoValued", assigneeId: "thomas", choreType: "see_and_do", coinValue: 15 }),
    ]);
    expect(immediate.map((entry) => entry.id)).toEqual(["seeAndDoValued"]);
    expect(needsCoins).toHaveLength(0);
  });
});

describe("summarizeApprovals", () => {
  it("totals chores across children", () => {
    const groups = groupApprovalsByChild(
      [
        chore({ id: "1", assigneeId: "thomas" }),
        chore({ id: "2", assigneeId: "thomas" }),
        chore({ id: "3", assigneeId: "helena" }),
      ],
      directory,
      "Family",
    );
    const summary = summarizeApprovals(groups);
    expect(summary.total).toBe(3);
    expect(summary.perChild).toEqual([
      { key: "thomas", name: "Thomas", count: 2 },
      { key: "helena", name: "Helena", count: 1 },
    ]);
  });
});

describe("resolveApprovalChoreType", () => {
  it("classifies routine, see & do, ghost, and standard chores", () => {
    expect(resolveApprovalChoreType(chore({ id: "1", routineId: "r1" }))).toBe("routine");
    expect(resolveApprovalChoreType(chore({ id: "2", choreType: "see_and_do" }))).toBe("see_and_do");
    expect(resolveApprovalChoreType(chore({ id: "3", isGhost: true }))).toBe("ghost");
    expect(resolveApprovalChoreType(chore({ id: "4" }))).toBe("standard");
  });
});
