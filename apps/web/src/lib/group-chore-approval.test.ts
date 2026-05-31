import { describe, expect, it } from "vitest";
import {
  createApprovalAssigneeSelections,
  listApprovalPayouts,
  toggleApprovalAssigneeSelection,
} from "@packages/core";

describe("group chore approval helpers", () => {
  it("splits total coins exactly across assignees", () => {
    const selections = createApprovalAssigneeSelections(["a", "b", "c"], 5);

    expect(listApprovalPayouts(selections, ["a", "b", "c"])).toEqual([
      { assigneeId: "a", coinValue: 2 },
      { assigneeId: "b", coinValue: 2 },
      { assigneeId: "c", coinValue: 1 },
    ]);
  });

  it("rebalances remaining assignees when one is toggled off and back on", () => {
    const initial = createApprovalAssigneeSelections(["a", "b", "c"], 5);
    const withoutB = toggleApprovalAssigneeSelection(initial, ["a", "b", "c"], "b", 5);
    const restored = toggleApprovalAssigneeSelection(withoutB, ["a", "b", "c"], "b", 5);

    expect(listApprovalPayouts(withoutB, ["a", "b", "c"])).toEqual([
      { assigneeId: "a", coinValue: 3 },
      { assigneeId: "b", coinValue: 0 },
      { assigneeId: "c", coinValue: 2 },
    ]);
    expect(listApprovalPayouts(restored, ["a", "b", "c"])).toEqual([
      { assigneeId: "a", coinValue: 2 },
      { assigneeId: "b", coinValue: 2 },
      { assigneeId: "c", coinValue: 1 },
    ]);
  });
});
