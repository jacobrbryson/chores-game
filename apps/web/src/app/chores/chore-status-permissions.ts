type Translator = (key: string, params?: Record<string, string | number>) => string;

type ChoreApprovalState = {
  status: string;
  requireApproval?: boolean;
};

export function canUndoCompletion(status: string) {
  return status === "Submitted" || status === "Approved" || status === "Rejected";
}

export function canApproveChore(chore: ChoreApprovalState) {
  return chore.status === "Submitted" && Boolean(chore.requireApproval);
}

export function getStatusLabel(chore: ChoreApprovalState, t: Translator) {
  if (chore.status === "Submitted" && chore.requireApproval) {
    return t("choresPage.status.awaitingApproval");
  }
  if (chore.status === "Submitted" || chore.status === "Approved") {
    return t("choresPage.status.completed");
  }
  if (chore.status === "Open") {
    return t("choresPage.status.open");
  }
  if (chore.status === "Rejected") {
    return t("choresPage.status.rejected");
  }
  return chore.status;
}

export function getRowMenuDisabledReasons(
  chore: ChoreApprovalState,
  t: Translator,
  options?: { busy?: boolean },
) {
  const busyReason = options?.busy ? t("choresPage.menu.disabledReasons.actionInProgress") : "";
  if (busyReason) {
    return {
      trigger: busyReason,
      edit: busyReason,
      approve: busyReason,
      reject: busyReason,
      undo: busyReason,
      delete: busyReason,
    };
  }

  const statusLabel = getStatusLabel(chore, t);
  const approveReason = canApproveChore(chore)
    ? ""
    : chore.status === "Submitted"
      ? t("choresPage.menu.disabledReasons.approvalNotRequired")
      : t("choresPage.menu.disabledReasons.approveStatus", { status: statusLabel });
  const rejectReason = canApproveChore(chore)
    ? ""
    : chore.status === "Submitted"
      ? t("choresPage.menu.disabledReasons.approvalNotRequired")
      : t("choresPage.menu.disabledReasons.rejectStatus", { status: statusLabel });
  const rowMenuCanUndo = chore.status === "Submitted" || chore.status === "Approved";
  const undoReason = rowMenuCanUndo
    ? ""
    : t("choresPage.menu.disabledReasons.undoStatus", { status: statusLabel });

  return {
    trigger: "",
    edit: "",
    approve: approveReason,
    reject: rejectReason,
    undo: undoReason,
    delete: "",
  };
}
