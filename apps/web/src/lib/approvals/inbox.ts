// The Approval Inbox derivation (grouping, the approve-immediately vs
// needs-a-coin-value split, and the summary) lives in @packages/core so the web
// /approvals page and the mobile Approvals screen share one implementation.
// Re-exported here so existing `@/lib/approvals/inbox` imports keep working.
export {
  APPROVAL_COIN_QUICK_VALUES,
  FAMILY_GROUP_KEY,
  approvalAssigneeIds,
  defaultCoinsByAssignee,
  groupApprovalsByChild,
  isAwaitingApproval,
  isCoinValueHidden,
  needsCoinAssignment,
  resolveApprovalChoreType,
  splitForApproveAll,
  summarizeApprovals,
  type ApprovalChore,
  type ApprovalChoreType,
  type ApprovalGroup,
  type ApprovalSummary,
  type AssigneeDirectoryEntry,
} from "@packages/core";

// Analytics stub. There is no client analytics pipeline in the repo yet; this
// keeps the call sites ready so wiring a real pipeline later is a one-file change.
// TODO(analytics): forward these to the analytics pipeline once it exists.
export type ApprovalAnalyticsEvent =
  | "approval_inbox_opened"
  | "approval_inbox_approve"
  | "approval_inbox_approve_all"
  | "approval_inbox_reject"
  | "approval_time_to_review"
  | "dashboard_approval_card_clicked"
  | "notification_approval_clicked";

export function trackApproval(
  _event: ApprovalAnalyticsEvent,
  _payload?: Record<string, string | number | boolean>,
) {
  // no-op
}
