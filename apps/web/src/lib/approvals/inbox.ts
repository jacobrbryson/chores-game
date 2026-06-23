// Approval Inbox derivation helpers. The inbox is a client-side projection over
// the existing chores API (`/api/chores?status=needs_approval`): it groups the
// awaiting-approval chores by child and splits them into "approve immediately"
// vs "needs a coin value first" buckets. No business logic lives here — approval
// itself goes through `PATCH /api/chores/{id}` (see use-approval-actions.ts).
import {
  choreNeedsCoinAssignmentPrompt,
  shouldHideChoreCoinValue,
} from "@packages/core";
import type { ResponsibilityPillar } from "@/lib/responsibility/types";

// Subset of the chores API row that the inbox needs. Mirrors the shape returned
// by apps/web/src/app/api/chores/route.ts.
export type ApprovalChore = {
  id: string;
  title: string;
  choreType?: "normal" | "group" | "see_and_do" | string;
  status: string;
  source?: "manual" | "google_tasks" | string;
  assigneeId?: string;
  assigneeIds?: string[];
  assigneeScope?: "single" | "multiple" | "family" | string;
  assigneeName: string;
  assigneeAvatarId?: string;
  assigneeAvatarPhotoUrl?: string;
  assigneePrimaryColor?: string;
  completedAt?: string;
  coinValue: number;
  requireApproval?: boolean;
  isGhost?: boolean;
  responsibilityPillar?: ResponsibilityPillar | "";
  routineId?: string;
  routineName?: string;
  routineStepOrder?: number;
  routineStepCount?: number;
};

export type AssigneeDirectoryEntry = {
  id: string;
  name: string;
  avatarId?: string;
  avatarPhotoUrl?: string;
  primaryColor?: string;
};

export type ApprovalChoreType = "standard" | "routine" | "see_and_do" | "ghost";

export type ApprovalGroup = {
  // Stable grouping key (member id, or the family sentinel for family chores).
  key: string;
  name: string;
  avatarId?: string;
  avatarPhotoUrl?: string;
  primaryColor?: string;
  isFamily: boolean;
  chores: ApprovalChore[];
};

export type ApprovalSummary = {
  total: number;
  perChild: Array<{ key: string; name: string; count: number }>;
};

// Sentinel grouping key for family-scope chores (no single owning child).
export const FAMILY_GROUP_KEY = "__family__";

// A chore is awaiting parent approval when it has been submitted and the chore
// is configured to require approval. Same predicate the chores API and row menu
// use (chore-status-permissions.ts `canApproveChore`).
export function isAwaitingApproval(chore: Pick<ApprovalChore, "status" | "requireApproval">) {
  return chore.status === "Submitted" && Boolean(chore.requireApproval);
}

// Resolve the chore type shown on the review card. Ghost chores are AI-suggested
// (flagged by the chores API via `isGhost`); routine steps carry a routineId;
// See & Do is its own chore type; everything else is "standard".
export function resolveApprovalChoreType(chore: ApprovalChore): ApprovalChoreType {
  if (chore.choreType === "see_and_do") {
    return "see_and_do";
  }
  if (chore.isGhost) {
    return "ghost";
  }
  if (chore.routineId) {
    return "routine";
  }
  return "standard";
}

// True when the coin value must be hidden on the card because it is not yet
// assigned (See & Do with no predefined value). Re-exported for call sites that
// already import from this module.
export function isCoinValueHidden(chore: ApprovalChore) {
  return shouldHideChoreCoinValue(chore);
}

function primaryAssigneeKey(chore: ApprovalChore): { key: string; isFamily: boolean } {
  if (chore.assigneeScope === "family") {
    return { key: FAMILY_GROUP_KEY, isFamily: true };
  }
  const key =
    chore.assigneeId ||
    (chore.assigneeIds && chore.assigneeIds.length > 0 ? chore.assigneeIds[0] : "") ||
    FAMILY_GROUP_KEY;
  return { key, isFamily: key === FAMILY_GROUP_KEY };
}

// Group awaiting-approval chores by the child who completed them, preserving the
// order children first appear in the chore list so the queue is stable. Family-
// scope chores collapse into a single "Family" bucket.
export function groupApprovalsByChild(
  chores: ApprovalChore[],
  directory: AssigneeDirectoryEntry[],
  familyLabel: string,
): ApprovalGroup[] {
  const directoryByKey = new Map(directory.map((entry) => [entry.id, entry] as const));
  const groups = new Map<string, ApprovalGroup>();
  for (const chore of chores) {
    if (!isAwaitingApproval(chore)) {
      continue;
    }
    const { key, isFamily } = primaryAssigneeKey(chore);
    let group = groups.get(key);
    if (!group) {
      const entry = isFamily ? undefined : directoryByKey.get(key);
      group = {
        key,
        name: isFamily ? familyLabel : entry?.name || chore.assigneeName || key,
        avatarId: entry?.avatarId ?? (isFamily ? undefined : chore.assigneeAvatarId),
        avatarPhotoUrl:
          entry?.avatarPhotoUrl ?? (isFamily ? undefined : chore.assigneeAvatarPhotoUrl),
        primaryColor: entry?.primaryColor ?? chore.assigneePrimaryColor,
        isFamily,
        chores: [],
      };
      groups.set(key, group);
    }
    group.chores.push(chore);
  }
  return Array.from(groups.values());
}

// Split chores into those that can be approved with their predefined coin value
// and those that still need a coin value entered (See & Do without a value, or
// multi-assignee/family chores whose payout is split per assignee). Approve All
// uses this so it never silently assigns zero coins.
export function splitForApproveAll(chores: ApprovalChore[]): {
  immediate: ApprovalChore[];
  needsCoins: ApprovalChore[];
} {
  const immediate: ApprovalChore[] = [];
  const needsCoins: ApprovalChore[] = [];
  for (const chore of chores) {
    if (!isAwaitingApproval(chore)) {
      continue;
    }
    if (choreNeedsCoinAssignmentPrompt(chore)) {
      needsCoins.push(chore);
    } else {
      immediate.push(chore);
    }
  }
  return { immediate, needsCoins };
}

export function summarizeApprovals(groups: ApprovalGroup[]): ApprovalSummary {
  const perChild = groups.map((group) => ({
    key: group.key,
    name: group.name,
    count: group.chores.length,
  }));
  return {
    total: perChild.reduce((sum, child) => sum + child.count, 0),
    perChild,
  };
}

// Whether a chore needs the coin-selection step before it can be approved.
export function needsCoinAssignment(chore: ApprovalChore) {
  return choreNeedsCoinAssignmentPrompt(chore);
}

// The assignee ids a coin value must be entered for when approving a chore.
export function approvalAssigneeIds(chore: ApprovalChore): string[] {
  if (chore.assigneeIds && chore.assigneeIds.length > 0) {
    return chore.assigneeIds;
  }
  return chore.assigneeId ? [chore.assigneeId] : [];
}

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
