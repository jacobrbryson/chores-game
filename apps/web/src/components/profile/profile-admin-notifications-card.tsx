import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
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

const TOGGLE_LABELS: Array<{
  key: PushNotificationToggleKey;
  label: string;
  sampleType?: PushNotificationSampleType;
}> = [
  { key: "all", label: "All notifications" },
  { key: "choreCompleted", label: "When someone completes a chore", sampleType: "chore_completed" },
  { key: "rewardClaimed", label: "When someone claims a prize", sampleType: "reward_claimed" },
  {
    key: "choreApprovalRequired",
    label: "When someone's chore requires approval",
    sampleType: "chore_approval_required",
  },
];

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
  const settings = summary?.settings ?? {
    choreCompleted: false,
    rewardClaimed: false,
    choreApprovalRequired: false,
  };
  const allChecked =
    settings.choreCompleted &&
    settings.rewardClaimed &&
    settings.choreApprovalRequired;

  return (
    <>
      <div className="family-page-card-header">
        <div>
          <h2>Notifications</h2>
          <p className="small family-page-subhead">
            Admins can receive browser push notifications for family activity. Your browser will prompt you when you
            turn them on.
          </p>
        </div>
      </div>
      {loading ? <p className="small">Loading notification settings...</p> : null}
      {!loading && browserStatus ? <p className="small">{browserStatus}</p> : null}
      {!loading && summary && !summary.configured ? (
        <Alert>Push notifications are not configured on the server yet.</Alert>
      ) : null}
      {error ? <Alert>Could not save notification settings: {error}</Alert> : null}
      {success ? <p className="small">{success}</p> : null}
      <div className="profile-notification-checkboxes">
        {TOGGLE_LABELS.map((entry) => {
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
                  {samplePending === entry.sampleType ? "Sending..." : "Send Sample"}
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
          {saving ? "Saving..." : "Save notification settings"}
        </Button>
      </div>
    </>
  );
}
