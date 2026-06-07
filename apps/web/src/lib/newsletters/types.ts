import type { AppLocale } from "@packages/locales";

export type NewsletterSendStatus = "pending" | "sent" | "failed" | "skipped";

export type NewsletterSkippedReason =
  | "opt_out"
  | "invalid_email"
  | "duplicate_sent"
  | "no_activity"
  | "missing_support_email";

export type NewsletterRecipient = {
  uid: string;
  email: string;
  locale: AppLocale;
  name: string;
  optedIn: boolean;
};

export type WeeklyFamilyHighlightMetrics = {
  choresCompleted: number;
  coinsEarned: number;
  rewardsRedeemed: number;
  familyAwardsClaimed: number;
  questsCompleted: number;
  achievementsUnlocked: number;
  pendingApprovals: number;
  mostActiveHelperName: string;
  mostActiveHelperCount: number;
  mostActiveHelperAvatarId: string;
  mostActiveHelperAvatarPhotoUrl: string;
  mostActiveHelperPrimaryColor: string;
  recentHighlights: Array<{
    id: string;
    title: string;
    message: string;
    createdAt: string;
    icon: string;
  }>;
  hasActivity: boolean;
};

export type NewsletterSendRecord = {
  id: string;
  familyId: string;
  weekStart: string;
  weekEnd: string;
  recipientUid: string;
  recipientEmail: string;
  recipientLocale: AppLocale;
  status: NewsletterSendStatus;
  skippedReason: string;
  provider: string;
  providerMessageId: string;
  errorMessage: string;
  createdAt: string;
  sentAt: string;
  updatedAt: string;
};

export type WeeklyWindow = {
  weekStart: string;
  weekEnd: string;
  weekStartDateOnly: string;
  weekEndDateOnly: string;
};
