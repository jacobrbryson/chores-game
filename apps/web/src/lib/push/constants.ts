export const PUSH_NOTIFICATION_TYPE_VALUES = [
  "chore_completed",
  "reward_claimed",
  "chore_approval_required",
  "achievement_unlocked",
] as const;

export type PushNotificationType = (typeof PUSH_NOTIFICATION_TYPE_VALUES)[number];

export type PushNotificationSettings = {
  choreCompleted: boolean;
  rewardClaimed: boolean;
  choreApprovalRequired: boolean;
  achievementUnlocked: boolean;
};

export const DEFAULT_PUSH_NOTIFICATION_SETTINGS: PushNotificationSettings = {
  choreCompleted: false,
  rewardClaimed: false,
  choreApprovalRequired: false,
  achievementUnlocked: false,
};

export const PUSH_PERMISSION_VALUES = ["default", "denied", "granted"] as const;

export type PushPermissionState = (typeof PUSH_PERMISSION_VALUES)[number];

export function normalizePushNotificationSettings(
  input?: Partial<PushNotificationSettings> | null,
): PushNotificationSettings {
  return {
    choreCompleted: input?.choreCompleted === true,
    rewardClaimed: input?.rewardClaimed === true,
    choreApprovalRequired: input?.choreApprovalRequired === true,
    achievementUnlocked: input?.achievementUnlocked === true,
  };
}

export function hasAnyPushNotificationEnabled(settings: PushNotificationSettings) {
  return (
    settings.choreCompleted ||
    settings.rewardClaimed ||
    settings.choreApprovalRequired ||
    settings.achievementUnlocked
  );
}

export function isPushPermissionState(value: unknown): value is PushPermissionState {
  return typeof value === "string" && PUSH_PERMISSION_VALUES.includes(value as PushPermissionState);
}

export function pushSettingsAllowType(
  settings: PushNotificationSettings,
  type: PushNotificationType,
) {
  if (type === "chore_completed") {
    return settings.choreCompleted;
  }
  if (type === "reward_claimed") {
    return settings.rewardClaimed;
  }
  if (type === "achievement_unlocked") {
    return settings.achievementUnlocked;
  }
  return settings.choreApprovalRequired;
}

export function pushNotificationTargetUrl(type: PushNotificationType) {
  if (type === "chore_approval_required") {
    return "/chores?status=needs_approval";
  }
  if (type === "reward_claimed") {
    return "/family";
  }
  if (type === "achievement_unlocked") {
    return "/achievements";
  }
  return "/notifications?unseen=true";
}
