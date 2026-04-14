import type { StoreCategory } from "@/lib/store/catalog";

export type ProfilePageClientProps = {
  name: string;
  email: string;
  role: "admin" | "player";
  picture?: string;
  isSwitched?: boolean;
  authenticatedName?: string;
};

export type StoreProfileSummary = {
  ownedOptionIds?: string[];
  unlockedOptionDates?: Record<string, string>;
  categories?: StoreCategory[];
  dashboardPrimaryColor?: string;
  themeOptionId?: string;
  themePrimaryColor?: string;
  themeSecondaryColor?: string;
  themeTertiaryColor?: string;
  avatarId?: string;
  avatarPhotoUrl?: string;
  googlePhotoUrl?: string;
  selectedConfettiOptionId?: string;
};

export type GoogleTasksTaskListOption = {
  id: string;
  title: string;
  isDefault?: boolean;
};

export type GoogleTasksProfileSummary = {
  accountLinked?: boolean;
  linked: boolean;
  linkedAt?: string;
  lastSyncedAt?: string;
  lastSyncStatus?: "idle" | "ok" | "error";
  lastSyncError?: string;
  selectedTaskListIds?: string[];
  selectedTaskListTitles?: string[];
  selectedTaskListId?: string;
  selectedTaskListTitle?: string;
  taskLists?: GoogleTasksTaskListOption[];
};

export type ThemePalette = {
  primary: string;
  secondary: string;
  tertiary: string;
};

export type PushNotificationSettings = {
  choreCompleted: boolean;
  rewardClaimed: boolean;
  choreApprovalRequired: boolean;
};

export type PushNotificationsProfileSummary = {
  configured: boolean;
  permission: "default" | "denied" | "granted";
  settings: PushNotificationSettings;
  hasStoredSubscription: boolean;
  subscriptionCount: number;
  vapidPublicKey?: string;
};

export type PushNotificationToggleKey =
  | "all"
  | keyof PushNotificationSettings;

export type PushNotificationSampleType =
  | "chore_completed"
  | "reward_claimed"
  | "chore_approval_required";
