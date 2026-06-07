import { describe, expect, it } from "vitest";

import {
  canApproveChore,
  canUndoCompletion,
  getRowMenuDisabledReasons,
  getStatusLabel,
} from "./chore-status-permissions";

const t = (key: string, params?: Record<string, string | number>) => {
  if (params?.status) {
    return `${key}:${params.status}`;
  }
  return key;
};

describe("chore status permissions", () => {
  it("keeps undo completion available for completed and reviewed chores", () => {
    expect(canUndoCompletion("Submitted")).toBe(true);
    expect(canUndoCompletion("Approved")).toBe(true);
    expect(canUndoCompletion("Rejected")).toBe(true);
    expect(canUndoCompletion("Open")).toBe(false);
  });

  it("only allows approve when approval is required", () => {
    expect(canApproveChore({ status: "Submitted", requireApproval: true })).toBe(true);
    expect(canApproveChore({ status: "Submitted", requireApproval: false })).toBe(false);
    expect(canApproveChore({ status: "Approved", requireApproval: true })).toBe(false);
  });

  it("maps status labels for menu explanations", () => {
    expect(getStatusLabel({ status: "Open" }, t)).toBe("choresPage.status.open");
    expect(getStatusLabel({ status: "Submitted", requireApproval: true }, t)).toBe(
      "choresPage.status.awaitingApproval",
    );
    expect(getStatusLabel({ status: "Approved" }, t)).toBe("choresPage.status.completed");
  });

  it("explains why undo is disabled for open chores", () => {
    expect(getRowMenuDisabledReasons({ status: "Open" }, t).undo).toBe(
      "choresPage.menu.disabledReasons.undoStatus:choresPage.status.open",
    );
  });

  it("keeps row-menu undo explanations aligned with row-menu availability", () => {
    expect(getRowMenuDisabledReasons({ status: "Rejected" }, t).undo).toBe(
      "choresPage.menu.disabledReasons.undoStatus:choresPage.status.rejected",
    );
  });

  it("explains busy menu state consistently", () => {
    expect(getRowMenuDisabledReasons({ status: "Approved" }, t, { busy: true })).toEqual({
      trigger: "choresPage.menu.disabledReasons.actionInProgress",
      edit: "choresPage.menu.disabledReasons.actionInProgress",
      approve: "choresPage.menu.disabledReasons.actionInProgress",
      reject: "choresPage.menu.disabledReasons.actionInProgress",
      undo: "choresPage.menu.disabledReasons.actionInProgress",
      delete: "choresPage.menu.disabledReasons.actionInProgress",
    });
  });
});
