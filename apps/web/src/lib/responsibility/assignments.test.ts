import { describe, expect, it } from "vitest";
import {
  hasAnyCompletedStep,
  isAssignmentComplete,
  nextIncompleteStep,
  parseAssignmentStepsJson,
  routineAssignmentFromDoc,
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
});
