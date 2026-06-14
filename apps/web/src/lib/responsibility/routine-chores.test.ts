import { describe, expect, it } from "vitest";
import { collapseRoutineChores, isRoutineChore } from "./routine-chores";

type Row = {
  id: string;
  status: string;
  routineAssignmentId?: string;
  routineStepOrder?: number;
};

const plain = (id: string, status = "Open"): Row => ({ id, status });
const step = (id: string, assignment: string, order: number, status = "Open"): Row => ({
  id,
  status,
  routineAssignmentId: assignment,
  routineStepOrder: order,
});

describe("collapseRoutineChores", () => {
  it("keeps non-routine chores untouched", () => {
    const rows = [plain("a"), plain("b", "Submitted")];
    expect(collapseRoutineChores(rows)).toEqual(rows);
  });

  it("shows only the next open step per assignment", () => {
    const rows = [
      plain("a"),
      step("s1", "assign-1", 1),
      step("s2", "assign-1", 2),
      step("s3", "assign-1", 3),
    ];
    expect(collapseRoutineChores(rows).map((row) => row.id)).toEqual(["a", "s1"]);
  });

  it("advances to the next step once earlier steps leave Open status", () => {
    const rows = [
      step("s1", "assign-1", 1, "Approved"),
      step("s2", "assign-1", 2),
      step("s3", "assign-1", 3),
    ];
    expect(collapseRoutineChores(rows).map((row) => row.id)).toEqual(["s1", "s2"]);
  });

  it("keeps submitted steps visible for approval alongside the next open step", () => {
    const rows = [
      step("s1", "assign-1", 1, "Submitted"),
      step("s2", "assign-1", 2),
      step("s3", "assign-1", 3),
    ];
    expect(collapseRoutineChores(rows).map((row) => row.id)).toEqual(["s1", "s2"]);
  });

  it("collapses multiple assignments independently", () => {
    const rows = [
      step("a1", "assign-a", 1),
      step("b2", "assign-b", 2),
      step("a2", "assign-a", 2),
      step("b1", "assign-b", 1),
    ];
    expect(collapseRoutineChores(rows).map((row) => row.id)).toEqual(["a1", "b1"]);
  });
});

describe("isRoutineChore", () => {
  it("detects routine-linked rows", () => {
    expect(isRoutineChore(step("s1", "assign-1", 1))).toBe(true);
    expect(isRoutineChore(plain("a"))).toBe(false);
  });
});
