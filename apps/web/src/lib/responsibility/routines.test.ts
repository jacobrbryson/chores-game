import { describe, expect, it } from "vitest";
import {
  MAX_ROUTINE_STEPS,
  normalizeRoutineSteps,
  parseCompletedStepIdsJson,
  parseRoutineStepsJson,
} from "./routines";

describe("normalizeRoutineSteps", () => {
  it("accepts titled steps and assigns positional ids when missing", () => {
    const steps = normalizeRoutineSteps([
      { title: "Clear table" },
      { id: "load", title: "Load dishwasher" },
    ]);
    expect(steps).toEqual([
      { id: "step_1", title: "Clear table" },
      { id: "load", title: "Load dishwasher" },
    ]);
  });

  it("rejects empty lists, oversized lists, and untitled steps", () => {
    expect(normalizeRoutineSteps([])).toBeNull();
    expect(normalizeRoutineSteps(undefined)).toBeNull();
    expect(normalizeRoutineSteps([{ title: "" }])).toBeNull();
    expect(normalizeRoutineSteps([{ notTitle: "x" }])).toBeNull();
    const tooMany = Array.from({ length: MAX_ROUTINE_STEPS + 1 }, (_, i) => ({
      title: `Step ${i}`,
    }));
    expect(normalizeRoutineSteps(tooMany)).toBeNull();
  });

  it("de-duplicates colliding step ids", () => {
    const steps = normalizeRoutineSteps([
      { id: "a", title: "One" },
      { id: "a", title: "Two" },
    ]);
    expect(steps?.map((step) => step.id)).toEqual(["a", "a_2"]);
  });

  it("sanitizes unsafe characters in provided ids", () => {
    const steps = normalizeRoutineSteps([{ id: "x/y z", title: "One" }]);
    expect(steps?.[0].id).toBe("x_y_z");
  });
});

describe("steps JSON round-trip", () => {
  it("parses what it serializes and tolerates garbage", () => {
    const steps = [
      { id: "step_1", title: "Clear table" },
      { id: "step_2", title: "Sweep" },
    ];
    expect(parseRoutineStepsJson(JSON.stringify(steps))).toEqual(steps);
    expect(parseRoutineStepsJson("")).toEqual([]);
    expect(parseRoutineStepsJson("not json")).toEqual([]);
    expect(parseRoutineStepsJson('{"a":1}')).toEqual([]);
  });

  it("parses completed step ids defensively", () => {
    expect(parseCompletedStepIdsJson('["a","b"]')).toEqual(["a", "b"]);
    expect(parseCompletedStepIdsJson('["a",1]')).toEqual(["a"]);
    expect(parseCompletedStepIdsJson("oops")).toEqual([]);
  });
});
