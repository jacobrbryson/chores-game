import { describe, expect, it } from "vitest";
import {
  choreNeedsCoinAssignmentPrompt,
  shouldHideChoreCoinValue,
} from "@packages/core";

describe("chore coin assignment helpers", () => {
  it("keeps the approval prompt for see and do chores until coins are assigned", () => {
    expect(
      choreNeedsCoinAssignmentPrompt({
        choreType: "see_and_do",
        assigneeScope: "single",
        assigneeIds: ["child-1"],
        coinValue: 0,
      }),
    ).toBe(true);
  });

  it("skips the approval prompt for single-assignee see and do chores with saved coins", () => {
    expect(
      choreNeedsCoinAssignmentPrompt({
        choreType: "see_and_do",
        assigneeScope: "single",
        assigneeIds: ["child-1"],
        coinValue: 7,
      }),
    ).toBe(false);
  });

  it("still requires the approval prompt for multi-assignee chores", () => {
    expect(
      choreNeedsCoinAssignmentPrompt({
        choreType: "normal",
        assigneeScope: "multiple",
        assigneeIds: ["child-1", "child-2"],
        coinValue: 12,
      }),
    ).toBe(true);
  });

  it("hides pending see and do coins only while they are still unset", () => {
    expect(
      shouldHideChoreCoinValue({
        choreType: "see_and_do",
        status: "Open",
        coinValue: 0,
      }),
    ).toBe(true);

    expect(
      shouldHideChoreCoinValue({
        choreType: "see_and_do",
        status: "Open",
        coinValue: 7,
      }),
    ).toBe(false);
  });
});
