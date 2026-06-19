import type { SessionUser } from "@/lib/auth/session";
import type { ChoreRecurrenceConfig } from "@/lib/chores/recurrence";
import type { NewSkillBonusOutcome } from "@/lib/chores/bonus-award";
import type { ChoreXpOutcome } from "@/lib/responsibility/service";
import type { RoutineStepProgressOutcome } from "@/lib/responsibility/assignment-service";

export const MAX_ACTIVE_CHORES_PER_ASSIGNEE = 100;

export type UpdateChoreBody = {
  action?: unknown;
  description?: unknown;
  assigneeId?: unknown;
  assigneeIds?: unknown;
  assigneeScope?: unknown;
  dueDate?: unknown;
  details?: unknown;
  categoryIds?: unknown;
  coinValue?: unknown;
  requireApproval?: unknown;
  newSkillEnabled?: unknown;
  recurrenceType?: unknown;
  recurrenceInterval?: unknown;
  recurrenceUnit?: unknown;
  recurrenceDays?: unknown;
  feedback?: unknown;
  approvalPayouts?: unknown;
  responsibilityPillar?: unknown;
};

// Everything a PATCH action handler needs: request session, resolved family,
// the normalized request inputs, and the shared timestamp/actor name. Computed
// once in the PATCH handler and passed to the dispatched action.
export type ChoreActionContext = {
  familyId: string;
  idToken: string;
  session: SessionUser;
  choreId: string;
  now: string;
  actorName: string;
  body: UpdateChoreBody;
  normalizedDescription: string;
  dueDate: string;
  details: string;
  coinValue: number | null;
  requireApproval: boolean;
  newSkillEnabled: boolean | undefined;
  recurrence: ChoreRecurrenceConfig;
  feedback: string;
  hasCategoryIds: boolean;
  categoryIds: string[];
  hasResponsibilityPillar: boolean;
  responsibilityPillar: string;
  resolvedAssigneeIds: string[];
  resolvedAssigneeScope: "single" | "multiple" | "family";
  resolvedSingleAssigneeId: string;
};

// Success payload pieces surfaced back to the PATCH response builder.
export type ChoreActionSuccess = {
  kind: "ok";
  // When set, the PATCH handler runs a forced Google Tasks sync for this uid.
  syncOwnerUid: string;
  newSkillBonus: NewSkillBonusOutcome;
  responsibilityXp: ChoreXpOutcome;
  routineProgress: RoutineStepProgressOutcome | null;
};

export type ChoreActionError =
  | { kind: "chore_not_found" }
  | { kind: "forbidden_action" }
  | { kind: "invalid_transition" }
  | { kind: "wallet_negative_blocked" }
  | { kind: "wallet_permission_denied" }
  | { kind: "recurring_successor_locked" }
  | { kind: "active_chore_limit_reached" }
  | { kind: "invalid_category_ids" }
  | { kind: "not_routine_step" }
  | { kind: "routine_step_single_assignee_only" };

export type ChoreActionOutcome = ChoreActionSuccess | ChoreActionError;

export const EMPTY_RESPONSIBILITY_XP: ChoreXpOutcome = {
  pillar: "",
  choreXpAwarded: 0,
  newSkillXpAwarded: 0,
};
