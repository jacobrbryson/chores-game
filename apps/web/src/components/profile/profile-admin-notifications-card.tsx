import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import { useLocale } from "@/components/locale-provider";
import type {
  PushNotificationSampleType,
  PushNotificationsProfileSummary,
  PushNotificationToggleKey,
} from "@/components/profile/profile-page.types";

type ProfileAdminNotificationsCardProps = {
  summary: PushNotificationsProfileSummary | null;
  loading: boolean;
  saving: boolean;
  error: string;
  success: string;
  browserStatus: string;
  samplePending: string;
  sampleDisabled: boolean;
  onToggle: (key: PushNotificationToggleKey, checked: boolean) => void;
  onSave: () => void;
  onSendSample: (type: PushNotificationSampleType) => void;
};

export function ProfileAdminNotificationsCard({
  summary,
  loading,
  saving,
  error,
  success,
  browserStatus,
  samplePending,
  sampleDisabled,
  onToggle,
  onSave,
  onSendSample,
}: ProfileAdminNotificationsCardProps) {
  const { t } = useLocale();
  const settings = summary?.settings ?? {
    choreCompleted: false,
    rewardClaimed: false,
    choreApprovalRequired: false,
    achievementUnlocked: false,
  };
  const allChecked =
    settings.choreCompleted &&
    settings.rewardClaimed &&
    settings.choreApprovalRequired &&
    settings.achievementUnlocked;
  const toggleLabels: Array<{
    key: PushNotificationToggleKey;
    label: string;
    sampleType?: PushNotificationSampleType;
  }> = [
    { key: "all", label: t("profile.notifications.pushAll") },
    {
      key: "choreCompleted",
      label: t("profile.notifications.pushChoreCompleted"),
      sampleType: "chore_completed",
    },
    {
      key: "rewardClaimed",
      label: t("profile.notifications.pushRewardClaimed"),
      sampleType: "reward_claimed",
    },
    {
      key: "choreApprovalRequired",
      label: t("profile.notifications.pushApprovalRequired"),
      sampleType: "chore_approval_required",
    },
    {
      key: "achievementUnlocked",
      label: t("profile.notifications.pushAchievementUnlocked"),
      sampleType: "achievement_unlocked",
    },
  ];

  return (
    <section aria-label={t("profile.notifications.pushTitle")} className="space-y-4">
      <div className="family-page-card-header">
        <div>
          <h3>{t("profile.notifications.pushTitle")}</h3>
          <p className="small family-page-subhead">{t("profile.notifications.pushDescription")}</p>
        </div>
      </div>
      {loading ? <p className="small">{t("profile.notifications.pushLoading")}</p> : null}
      {!loading && browserStatus ? <p className="small">{browserStatus}</p> : null}
      {!loading && summary && !summary.configured ? (
        <Alert>{t("profile.notifications.pushUnavailable")}</Alert>
      ) : null}
      {error ? <Alert>{t("profile.notifications.pushSaveError", { error })}</Alert> : null}
      {success ? <p className="small">{success}</p> : null}
      <div className="profile-notification-checkboxes">
        {toggleLabels.map((entry) => {
          const checked =
            entry.key === "all"
              ? allChecked
              : settings[entry.key];
          return (
            <div key={entry.key} className="profile-notification-row">
              <label className="profile-notification-checkbox">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={loading || saving || !summary?.configured}
                  onChange={(event) => onToggle(entry.key, event.target.checked)}
                />
                <span>{entry.label}</span>
              </label>
              {entry.sampleType ? (
                <Button
                  type="button"
                  className="btn btn-secondary profile-notification-sample-btn"
                  disabled={sampleDisabled || !checked || samplePending.length > 0}
                  onClick={() => onSendSample(entry.sampleType!)}>
                  {samplePending === entry.sampleType
                    ? t("profile.notifications.pushSendingSample")
                    : t("profile.notifications.pushSendSample")}
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="profile-google-actions">
        <Button
          type="button"
          className="btn btn-primary"
          disabled={loading || saving || !summary?.configured}
          onClick={onSave}>
          {saving ? t("profile.notifications.pushSaving") : t("profile.notifications.pushSave")}
        </Button>
      </div>
    </section>
  );
}
