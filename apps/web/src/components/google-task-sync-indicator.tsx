import { GoogleGIcon } from "@/components/google-g-icon";

type GoogleTaskSyncIndicatorProps = {
  className?: string;
  label?: string;
};

export function GoogleTaskSyncIndicator({
  className = "",
  label = "Synced",
}: GoogleTaskSyncIndicatorProps) {
  const classes = ["google-task-sync-indicator", className].filter(Boolean).join(" ");
  return (
    <span className={classes} title="Synced with Google Tasks">
      <GoogleGIcon className="google-task-sync-g-icon" />
      <span className="google-task-sync-refresh-mark" aria-hidden="true">
        &#x21bb;
      </span>
      <span className="google-task-sync-label">{label}</span>
    </span>
  );
}
