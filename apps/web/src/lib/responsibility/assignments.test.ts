import { describe, expect, it } from "vitest";
import {
  hasAnyCompletedStep,
  isAssignmentComplete,
  nextIncompleteStep,
  overdueRoutineRolloverDueDate,
  parseAssignmentStepsJson,
  resolveNextRecurringOccurrence,
  routineAssignmentFromDoc,
  shouldArchiveRoutineStepOnRollover,
  type RoutineAssignment,
} from "./assignments";
import { stringField } from "@/lib/firestore/rest";

const steps = [
  { id: "step_1", title: "Make bed", order: 1, choreId: "chore-1", coinValue: 5, requireApproval: false },
  { id: "step_2", title: "Pick up Legos", order: 2, choreId: "chore-2", coinValue: 5, requireApproval: true },
  { id: "step_3", title: "Empty trash", order: 3, choreId: "chore-3", coinValue: 0, requireApproval: false },
];

function assignmentWith(
  completedStepIds: string[],
  skippedStepIds: string[] = [],
): RoutineAssignment {
  return {
    id: "assignment-1",
    routineId: "routine-1",
    routineName: "Clean Room",
    pillar: "organization",
    assigneeId: "kid-1",
    assigneeName: "Thomas",
    assignedBy: "parent-1",
    status: "active",
    requireApproval: false,
    steps,
    completedStepIds,
    skippedStepIds,
    completionBonusXp: -1,
    completionBonusCoins: 5,
    dueDate: "2026-06-12",
    recurrenceType: "none",
  };
}

describe("parseAssignmentStepsJson", () => {
  it("round-trips steps and sorts by order", () => {
    const shuffled = [steps[2], steps[0], steps[1]];
    expect(parseAssignmentStepsJson(JSON.stringify(shuffled))).toEqual(steps);
  });

  it("tolerates garbage and missing coin/approval values", () => {
    expect(parseAssignmentStepsJson("")).toEqual([]);
    expect(parseAssignmentStepsJson("not json")).toEqual([]);
    expect(parseAssignmentStepsJson('{"a":1}')).toEqual([]);
    const bare = [{ id: "a", title: "X", order: 1, choreId: "c" }];
    const parsed = parseAssignmentStepsJson(JSON.stringify(bare))[0];
    expect(parsed.coinValue).toBe(0);
    expect(parsed.requireApproval).toBe(false);
  });

  it("drops malformed entries", () => {
    const mixed = [steps[0], { id: "broken" }, 42];
    expect(parseAssignmentStepsJson(JSON.stringify(mixed))).toEqual([steps[0]]);
  });
});

describe("assignment progress helpers", () => {
  it("finds the next incomplete step in order", () => {
    expect(nextIncompleteStep(assignmentWith([]))?.id).toBe("step_1");
    expect(nextIncompleteStep(assignmentWith(["step_1"]))?.id).toBe("step_2");
    expect(nextIncompleteStep(assignmentWith(["step_2"]))?.id).toBe("step_1");
    expect(nextIncompleteStep(assignmentWith(["step_1", "step_2", "step_3"]))).toBeNull();
  });

  it("treats an assignment as complete only when every step is done", () => {
    expect(isAssignmentComplete(assignmentWith([]))).toBe(false);
    expect(isAssignmentComplete(assignmentWith(["step_1", "step_2"]))).toBe(false);
    expect(isAssignmentComplete(assignmentWith(["step_1", "step_2", "step_3"]))).toBe(true);
  });

  it("counts a skipped step as resolved for completion", () => {
    // Two completed + one skipped = every step resolved → complete.
    expect(isAssignmentComplete(assignmentWith(["step_1", "step_2"], ["step_3"]))).toBe(true);
    // One completed, one skipped, one still open → not complete.
    expect(isAssignmentComplete(assignmentWith(["step_1"], ["step_2"]))).toBe(false);
    // Every step skipped, nothing completed → still "complete" (closes out)…
    expect(isAssignmentComplete(assignmentWith([], ["step_1", "step_2", "step_3"]))).toBe(true);
  });

  it("only reports a completed step as actual work, not a skip", () => {
    // …but a purely-skipped routine did no real work, so no bonus.
    expect(hasAnyCompletedStep(assignmentWith([], ["step_1", "step_2", "step_3"]))).toBe(false);
    expect(hasAnyCompletedStep(assignmentWith(["step_2"], ["step_1", "step_3"]))).toBe(true);
    expect(hasAnyCompletedStep(assignmentWith([]))).toBe(false);
  });

  it("skips over skipped steps when finding the next step", () => {
    expect(nextIncompleteStep(assignmentWith([], ["step_1"]))?.id).toBe("step_2");
    expect(nextIncompleteStep(assignmentWith(["step_1"], ["step_2"]))?.id).toBe("step_3");
    expect(nextIncompleteStep(assignmentWith(["step_1"], ["step_2", "step_3"]))).toBeNull();
  });
});

describe("resolveNextRecurringOccurrence", () => {
  it("keeps the current snapshot when no template is available", () => {
    const assignment = assignmentWith(["step_1", "step_2"]);
    const next = resolveNextRecurringOccurrence(assignment, null);

    expect(next.routine.name).toBe("Clean Room");
    expect(next.steps.map((step) => step.title)).toEqual([
      "Make bed",
      "Pick up Legos",
      "Empty trash",
    ]);
    expect(assignment.completedStepIds).toEqual(["step_1", "step_2"]);
  });

  it("uses edited steps only for the next occurrence", () => {
    const assignment = assignmentWith(["step_1", "step_2"]);
    const next = resolveNextRecurringOccurrence(assignment, {
      id: "routine-1",
      name: "Carpe Diem",
      pillar: "self_care",
      completionBonusXp: 8,
      completionBonusCoins: 3,
      steps: [
        { id: "step_1", title: "Make the bed" },
        { id: "step_4", title: "Clean your bathroom sink" },
      ],
    });

    expect(next.routine.name).toBe("Carpe Diem");
    expect(next.steps).toEqual([
      {
        id: "step_1",
        title: "Make the bed",
        coinValue: 5,
        requireApproval: false,
      },
      {
        id: "step_4",
        title: "Clean your bathroom sink",
        coinValue: 10,
        requireApproval: false,
      },
    ]);
    expect(assignment.steps).toHaveLength(3);
    expect(assignment.completedStepIds).toEqual(["step_1", "step_2"]);
  });
});

describe("overdueRoutineRolloverDueDate", () => {
  it("rolls a partially completed daily routine into today", () => {
    const assignment = {
      ...assignmentWith(["step_1"]),
      dueDate: "2026-08-10",
      recurrenceType: "daily" as const,
    };
    expect(overdueRoutineRolloverDueDate(assignment, "2026-08-11")).toBe("2026-08-11");
    expect(assignment.completedStepIds).toEqual(["step_1"]);
  });

  it("catches up missed occurrences without scheduling beyond today", () => {
    expect(
      overdueRoutineRolloverDueDate(
        {
          ...assignmentWith([]),
          dueDate: "2026-07-20",
          recurrenceType: "weekly",
        },
        "2026-08-11",
      ),
    ).toBe("2026-08-10");
  });

  it("uses the latest selected weekday for a custom weekly routine", () => {
    expect(
      overdueRoutineRolloverDueDate(
        {
          ...assignmentWith([]),
          dueDate: "2026-08-10",
          recurrenceType: "custom",
          recurrenceInterval: 1,
          recurrenceUnit: "week",
          recurrenceDays: ["mon", "tue", "wed", "thu", "fri"],
        },
        "2026-08-12",
      ),
    ).toBe("2026-08-12");
  });

  it("does not roll current, completed, non-recurring, or instant assignments", () => {
    expect(overdueRoutineRolloverDueDate(assignmentWith([]), "2026-08-11")).toBeNull();
    expect(
      overdueRoutineRolloverDueDate(
        { ...assignmentWith([]), dueDate: "2026-08-11", recurrenceType: "daily" },
        "2026-08-11",
      ),
    ).toBeNull();
    expect(
      overdueRoutineRolloverDueDate(
        {
          ...assignmentWith([]),
          status: "completed",
          dueDate: "2026-08-10",
          recurrenceType: "daily",
        },
        "2026-08-11",
      ),
    ).toBeNull();
    expect(
      overdueRoutineRolloverDueDate(
        { ...assignmentWith([]), dueDate: "2026-08-10", recurrenceType: "instant" },
        "2026-08-11",
      ),
    ).toBeNull();
  });
});

describe("shouldArchiveRoutineStepOnRollover", () => {
  it("archives only unresolved chores and preserves submitted or paid work", () => {
    expect(shouldArchiveRoutineStepOnRollover("Open", false)).toBe(true);
    expect(shouldArchiveRoutineStepOnRollover("Skipped", false)).toBe(true);
    expect(shouldArchiveRoutineStepOnRollover("Submitted", false)).toBe(false);
    expect(shouldArchiveRoutineStepOnRollover("Approved", false)).toBe(false);
    expect(shouldArchiveRoutineStepOnRollover("Open", true)).toBe(false);
  });
});

describe("routineAssignmentFromDoc", () => {
  it("parses a Firestore document defensively", () => {
    const assignment = routineAssignmentFromDoc({
      name: "projects/p/databases/(default)/documents/families/f/routineAssignments/assignment-1",
      fields: {
        routineId: stringField("routine-1"),
        routineName: stringField("Clean Room"),
        pillar: stringField("organization"),
        assigneeId: stringField("kid-1"),
        status: stringField("completed"),
        stepsJson: stringField(JSON.stringify(steps)),
        completedStepIdsJson: stringField('["step_1"]'),
      },
    });
    expect(assignment.id).toBe("assignment-1");
    expect(assignment.routineName).toBe("Clean Room");
    expect(assignment.pillar).toBe("organization");
    expect(assignment.status).toBe("completed");
    expect(assignment.steps).toHaveLength(3);
    expect(assignment.completedStepIds).toEqual(["step_1"]);
    expect(assignment.completionBonusXp).toBe(-1);
    expect(assignment.recurrenceType).toBe("none");
  });

  it("normalizes unknown pillars and statuses", () => {
    const assignment = routineAssignmentFromDoc({
      name: "x/assignment-2",
      fields: {
        pillar: stringField("not_a_pillar"),
        status: stringField("weird"),
      },
    });
    expect(assignment.pillar).toBe("");
    expect(assignment.status).toBe("active");
  });

  it("preserves an expired rollover occurrence", () => {
    const assignment = routineAssignmentFromDoc({
      name: "x/assignment-3",
      fields: { status: stringField("expired") },
    });
    expect(assignment.status).toBe("expired");
  });
});
