import { describe, expect, it } from "vitest";
import {
  aggregateChoreUsage,
  buildRoutineCountByKey,
  normalizeChoreTitleKey,
  type ChoreUsageInput,
  type RoutineStepsInput,
} from "./chore-usage";

describe("normalizeChoreTitleKey", () => {
  it("collapses case, punctuation, and whitespace", () => {
    expect(normalizeChoreTitleKey("Clean Room")).toBe("clean room");
    expect(normalizeChoreTitleKey("  clean   room! ")).toBe("clean room");
    expect(normalizeChoreTitleKey("Clean-Room")).toBe("clean room");
  });

  it("drops articles and possessives so obvious variants merge", () => {
    expect(normalizeChoreTitleKey("Clean Room")).toBe(
      normalizeChoreTitleKey("clean your room"),
    );
    expect(normalizeChoreTitleKey("Take out the trash")).toBe(
      normalizeChoreTitleKey("Take out trash"),
    );
  });

  it("does not merge genuinely different chores", () => {
    expect(normalizeChoreTitleKey("Clean room")).not.toBe(
      normalizeChoreTitleKey("Clean kitchen"),
    );
  });

  it("falls back to the cleaned title when only stop words remain", () => {
    expect(normalizeChoreTitleKey("the")).toBe("the");
  });

  it("handles empty/missing titles", () => {
    expect(normalizeChoreTitleKey("")).toBe("");
    expect(normalizeChoreTitleKey("   ")).toBe("");
  });
});

describe("buildRoutineCountByKey", () => {
  it("counts a chore once per routine even if the routine repeats it", () => {
    const routines: RoutineStepsInput[] = [
      { routineId: "r1", stepTitles: ["Clean room", "clean your room", "Make bed"] },
    ];
    const counts = buildRoutineCountByKey(routines);
    expect(counts.get("clean room")).toBe(1);
    expect(counts.get("make bed")).toBe(1);
  });

  it("counts distinct routines that share a normalized step title", () => {
    const routines: RoutineStepsInput[] = [
      { routineId: "r1", stepTitles: ["Clean Room"] },
      { routineId: "r2", stepTitles: ["clean your room"] },
      { routineId: "r3", stepTitles: ["Make bed"] },
    ];
    const counts = buildRoutineCountByKey(routines);
    expect(counts.get("clean room")).toBe(2);
    expect(counts.get("make bed")).toBe(1);
  });

  it("ignores blank step titles", () => {
    const counts = buildRoutineCountByKey([{ routineId: "r1", stepTitles: ["", "  "] }]);
    expect(counts.size).toBe(0);
  });
});

describe("aggregateChoreUsage", () => {
  const inputs: ChoreUsageInput[] = [
    { title: "Clean Room", familyId: "fam1", recurrenceType: "weekly" },
    { title: "clean your room", familyId: "fam2", recurrenceType: "none" },
    { title: "Clean Room", familyId: "fam1", recurrenceType: "daily" },
    { title: "Take out trash", familyId: "fam3", recurrenceType: "none" },
  ];

  it("counts total chores across all families", () => {
    const summary = aggregateChoreUsage(inputs);
    expect(summary.totalChores).toBe(4);
  });

  it("merges normalized variants into one usage row", () => {
    const summary = aggregateChoreUsage(inputs);
    expect(summary.uniqueChores).toBe(2);
    const cleanRoom = summary.usage.find((row) => row.key === "clean room");
    expect(cleanRoom?.count).toBe(3);
    // fam1 (twice) + fam2 = two distinct families.
    expect(cleanRoom?.familyCount).toBe(2);
  });

  it("counts recurring chores separately from routines", () => {
    const summary = aggregateChoreUsage(inputs);
    // "weekly" + "daily" recur, "none" does not (plus "Take out trash" = none).
    expect(summary.recurringChores).toBe(2);
    // Without a routine index, routineCount is 0.
    expect(summary.usage.every((row) => row.routineCount === 0)).toBe(true);
  });

  it("attaches routine counts from the routine index", () => {
    const routineCountByKey = buildRoutineCountByKey([
      { routineId: "fam1/morning", stepTitles: ["Clean your room", "Brush teeth"] },
      { routineId: "fam2/bedtime", stepTitles: ["Clean Room", "Read a book"] },
      { routineId: "fam3/chores", stepTitles: ["Take out the trash"] },
    ]);
    const summary = aggregateChoreUsage(inputs, { routineCountByKey });
    const cleanRoom = summary.usage.find((row) => row.key === "clean room");
    // "Clean your room" and "Clean Room" normalize to the same key across two
    // distinct routines.
    expect(cleanRoom?.routineCount).toBe(2);
    const trash = summary.usage.find((row) => row.key === "take out trash");
    expect(trash?.routineCount).toBe(1);
  });

  it("picks the most common original title for display", () => {
    const summary = aggregateChoreUsage(inputs);
    const cleanRoom = summary.usage.find((row) => row.key === "clean room");
    expect(cleanRoom?.title).toBe("Clean Room");
  });

  it("sorts most-used first", () => {
    const summary = aggregateChoreUsage(inputs);
    expect(summary.usage[0]?.key).toBe("clean room");
  });

  it("counts distinct families at the top level", () => {
    const summary = aggregateChoreUsage(inputs);
    expect(summary.familyCount).toBe(3);
  });

  it("respects topN", () => {
    const summary = aggregateChoreUsage(inputs, { topN: 1 });
    expect(summary.usage).toHaveLength(1);
    // uniqueChores still reflects the full set.
    expect(summary.uniqueChores).toBe(2);
  });
});
