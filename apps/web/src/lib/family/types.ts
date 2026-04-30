import type {
  ChoreRecurrenceType,
  ChoreRecurrenceUnit,
} from "@/lib/chores/recurrence";

export type FamilyCategory = {
  id: string;
  name: string;
  color: string;
};

export type FamilySnapshotMember = {
  id: string;
  uid?: string;
  name: string;
  email: string;
  role: "admin" | "player";
  status: "active" | "invited";
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
  recurrenceType?: ChoreRecurrenceType;
  recurrenceInterval?: number;
  recurrenceUnit?: ChoreRecurrenceUnit;
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
  };
  members: FamilySnapshotMember[];
  categories: FamilyCategory[];
  choresToday: FamilySnapshotChore[];
  pendingInvite: FamilyPendingInvite | null;
};
