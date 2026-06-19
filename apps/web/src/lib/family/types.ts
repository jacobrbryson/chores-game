import type { AppLocale } from "@packages/locales";
import type {
  ChoreRecurrenceType,
  ChoreRecurrenceWeekday,
  ChoreRecurrenceUnit,
} from "@/lib/chores/recurrence";
import type { ChoreType } from "@/lib/chores/types";
import type { ResponsibilityPillar } from "@/lib/responsibility/types";

export type FamilyCategory = {
  id: string;
  name: string;
  color: string;
  // Family members this category belongs to. Empty/absent means the category
  // applies to the whole family (shown to everyone).
  memberIds?: string[];
  // Legacy single-member field preserved for compatibility with older callers.
  memberId?: string;
};

export type FamilySnapshotMember = {
  id: string;
  uid?: string;
  name: string;
  email: string;
  role: "admin" | "player";
  status: "active" | "invited";
  locale?: AppLocale;
  resolvedLocale: AppLocale;
  lastSignInAt?: string;
  dashboardPrimaryColor?: string;
  avatarId?: string;
  avatarPhotoUrl?: string;
  stats: {
    lifetimeChoresCompleted: number;
    lifetimeCoinsEarned: number;
    currentCoins: number;
  };
};

export type FamilyPendingInvite = {
  familyId: string;
  familyName: string;
  invitedEmail: string;
  invitedAt?: string;
  inviter: {
    id: string;
    name: string;
    email: string;
  } | null;
};

export type FamilySnapshotChore = {
  id: string;
  title: string;
  choreType?: ChoreType;
  status: "Open" | "Submitted" | "Approved" | "Rejected" | "Unknown";
  source?: "manual" | "google_tasks";
  sortOrder?: number;
  createdAt?: string;
  assigneeId?: string;
  assigneeIds?: string[];
  assigneeScope?: "single" | "multiple" | "family";
  assigneeName: string;
  assigneePrimaryColor?: string;
  assigneeAvatarId?: string;
  assigneeAvatarPhotoUrl?: string;
  dueDate: string;
  details?: string;
  categoryIds?: string[];
  categories?: FamilyCategory[];
  coinValue: number;
  requireApproval?: boolean;
  newSkillEnabled?: boolean;
  recurrenceType?: ChoreRecurrenceType;
  recurrenceInterval?: number;
  recurrenceUnit?: ChoreRecurrenceUnit;
  recurrenceDays?: ChoreRecurrenceWeekday[];
  // Which Responsibility Pillar this chore develops; drives the pillar chip
  // on dashboard rows. Optional — most chores may have no pillar.
  responsibilityPillar?: ResponsibilityPillar;
  // New Skill Bonus: true when the assigned child has never completed this chore
  // (by recurring-root identity) before, so the dashboard shows a "+5 New Skill"
  // badge. Only set for single-assignee chores; omitted for multi/family chores.
  newSkillBonusEligible?: boolean;
  newSkillBonusAmount?: number;
  // Routine linkage: set when this chore is a materialized step of a routine
  // assignment, so the dashboard can badge the row and collapse sibling steps.
  routineAssignmentId?: string;
  routineId?: string;
  routineName?: string;
  routineStepOrder?: number;
  routineStepCount?: number;
  // Optional in-app deep link (e.g. seeded getting-started tasks point at /family,
  // /store, /profile). When present the dashboard card shows a quick-jump link.
  actionHref?: string;
  actionLabel?: string;
};

export type FamilySummaryResponse = {
  viewerUid: string;
  viewerAssigneeAliases?: string[];
  viewerGoogleTasksLinked?: boolean;
  wsAuthToken?: string;
  noFamily: boolean;
  family: null | {
    id: string;
    name: string;
    defaultLocale: AppLocale;
  };
  resolvedLocale?: AppLocale;
  members: FamilySnapshotMember[];
  categories: FamilyCategory[];
  choresToday: FamilySnapshotChore[];
  pendingInvite: FamilyPendingInvite | null;
};
