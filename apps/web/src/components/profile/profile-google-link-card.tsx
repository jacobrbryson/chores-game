import Image from "next/image";
import { Button } from "@/components/button";
import { GoogleSignInButton } from "@/components/google-signin-button";
import { TailwindMultiSelect } from "@/components/tailwind-multi-select";
import type { TailwindSelectOption } from "@/components/tailwind-select";
import type { GoogleTasksProfileSummary } from "@/components/profile/profile-page.types";

type ProfileGoogleLinkCardProps = {
  googleTasksRedirectError: string;
  googleTasksError: string;
  googleTasksLoading: boolean;
  googleTasksLinked: boolean;
  selectedGoogleTaskListSummary: string;
  googleTasksLastSyncedLabel: string;
  googleTasksStatusLabel: string;
  googleTaskListsLength: number;
  googleTaskListOptions: TailwindSelectOption<string>[];
  selectedGoogleTaskListIds: string[];
  showGoogleTaskListPicker: boolean;
  showGoogleTasksSyncNow: boolean;
  googleTasksActionPending: string;
  googleTasksSummary: GoogleTasksProfileSummary | null;
  onGoogleTasksLinkStart: () => void;
  onGoogleTasksTaskListChange: (taskListIds: string[]) => void;
  onGoogleTasksSyncNow: () => void;
  onGoogleTasksForceResync: () => void;
  onGoogleTasksUnlink: () => void;
};

export function ProfileGoogleLinkCard({
  googleTasksRedirectError,
  googleTasksError,
  googleTasksLoading,
  googleTasksLinked,
  selectedGoogleTaskListSummary,
  googleTasksLastSyncedLabel,
  googleTasksStatusLabel,
  googleTaskListsLength,
  googleTaskListOptions,
  selectedGoogleTaskListIds,
  showGoogleTaskListPicker,
  showGoogleTasksSyncNow,
  googleTasksActionPending,
  googleTasksSummary,
  onGoogleTasksLinkStart,
  onGoogleTasksTaskListChange,
  onGoogleTasksSyncNow,
  onGoogleTasksForceResync,
  onGoogleTasksUnlink,
}: ProfileGoogleLinkCardProps) {
  return (
    <section className="profile-google-card-wrap">
      <article className="profile-page-google-card">
        <h2>Link with Google</h2>
        <div className="profile-google-content-grid">
          <div className="profile-google-content-copy">
            {googleTasksRedirectError ? (
              <p className="small family-error">Could not finish Google link: {googleTasksRedirectError}</p>
            ) : null}
            {googleTasksError ? (
              <p className="small family-error">Google Tasks update failed: {googleTasksError}</p>
            ) : null}
            {googleTasksLoading ? <p className="small">Loading Google link status...</p> : null}
            {!googleTasksLoading && !googleTasksLinked ? (
              <>
                <p className="small">
                  Family Chores can link your profile to Google Tasks so your chore checklist stays in sync with the
                  Google tools your family already uses.
                </p>
                <p className="small profile-google-policy-alert">
                  <span className="profile-google-policy-alert-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" focusable="false">
                      <path
                        d="M12 3.5 2.8 19.5a1 1 0 0 0 .87 1.5h16.66a1 1 0 0 0 .87-1.5L12 3.5Zm0 5.3a1 1 0 0 1 1 1v5.1a1 1 0 1 1-2 0V9.8a1 1 0 0 1 1-1Zm0 9a1.15 1.15 0 1 1 0 2.3 1.15 1.15 0 0 1 0-2.3Z"
                        fill="currentColor"
                      />
                    </svg>
                  </span>
                  <span>
                    Syncing shares linked Google Tasks with all family members. Only guardians (admins) can
                    complete another family member&apos;s tasks.
                  </span>
                </p>
                <div className="profile-google-link-center-wrap">
                  <GoogleSignInButton
                    mode="action"
                    className="profile-google-link-btn"
                    label="Continue with Google"
                    onClick={onGoogleTasksLinkStart}
                  />
                </div>
              </>
            ) : null}
            {!googleTasksLoading && googleTasksLinked ? (
              <>
                <dl className="profile-page-fields profile-google-summary-list">
                  <div>
                    <dt>Linked Lists</dt>
                    <dd>{selectedGoogleTaskListSummary}</dd>
                  </div>
                  <div>
                    <dt>Last Synced</dt>
                    <dd>{googleTasksLastSyncedLabel}</dd>
                  </div>
                  <div>
                    <dt>Sync Status</dt>
                    <dd>{googleTasksStatusLabel}</dd>
                  </div>
                </dl>
                {showGoogleTaskListPicker ? (
                  <div className="profile-google-list-picker">
                    <span className="small">Google task lists</span>
                    <TailwindMultiSelect
                      ariaLabel="Google task lists"
                      options={googleTaskListOptions}
                      values={selectedGoogleTaskListIds}
                      disabled={googleTasksActionPending.length > 0}
                      placeholder="Select task lists"
                      onChange={onGoogleTasksTaskListChange}
                    />
                  </div>
                ) : null}
                {googleTasksSummary?.lastSyncError ? (
                  <p className="small family-error">Last sync issue: {googleTasksSummary.lastSyncError}</p>
                ) : null}
                <div className="profile-google-actions">
                  {showGoogleTasksSyncNow ? (
                    <Button
                      type="button"
                      className="btn btn-primary"
                      disabled={googleTasksActionPending.length > 0}
                      onClick={onGoogleTasksSyncNow}>
                      {googleTasksActionPending === "sync_now" || googleTasksActionPending === "force_sync_now"
                        ? "Syncing..."
                        : "Sync now"}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    className="btn btn-secondary"
                    disabled={googleTasksActionPending.length > 0}
                    onClick={onGoogleTasksForceResync}>
                    {googleTasksActionPending === "sync_now" || googleTasksActionPending === "force_sync_now"
                      ? "Syncing..."
                      : "Force Re-sync"}
                  </Button>
                  <Button
                    type="button"
                    className="btn btn-secondary"
                    disabled={googleTasksActionPending.length > 0}
                    onClick={onGoogleTasksUnlink}>
                    {googleTasksActionPending === "unlink" ? "Unlinking..." : "Unlink"}
                  </Button>
                </div>
              </>
            ) : null}
          </div>
          <div className="profile-google-media-layout">
            <figure className="profile-google-media-card profile-google-media-card-calendar">
              <Image
                src="/profile/calendar.png"
                alt="Google Calendar view with tasks."
                width={900}
                height={620}
                className="profile-google-media-image"
              />
              <figcaption>Synced tasks can show in Google Calendar.</figcaption>
            </figure>

          </div>
        </div>
      </article>
    </section>
  );
}

