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
  googleTasksActionPending: string;
  googleTasksSummary: GoogleTasksProfileSummary | null;
  onGoogleTasksLinkStart: () => void;
  onGoogleTasksTaskListChange: (taskListIds: string[]) => void;
  onGoogleTasksSyncNow: () => void;
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
  googleTasksActionPending,
  googleTasksSummary,
  onGoogleTasksLinkStart,
  onGoogleTasksTaskListChange,
  onGoogleTasksSyncNow,
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
                <p className="small">
                  Google Tasks can appear in Google Calendar when the task list is enabled there. You can pick which
                  Google task list this profile syncs with.
                </p>
                <p className="small profile-google-policy-alert">
                  Alert: syncing shares linked Google Tasks with all family members. Policy stays the same: only admins
                  can complete another family member&apos;s tasks.
                </p>
                <div className="profile-google-link-center-wrap">
                  <GoogleSignInButton
                    mode="action"
                    className="btn btn-primary profile-google-link-btn"
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
                {googleTaskListsLength > 0 ? (
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
                  <Button
                    type="button"
                    className="btn btn-primary"
                    disabled={googleTasksActionPending.length > 0}
                    onClick={onGoogleTasksSyncNow}>
                    {googleTasksActionPending === "sync_now" ? "Syncing..." : "Sync now"}
                  </Button>
                  <Button
                    type="button"
                    className="btn btn-secondary"
                    disabled={googleTasksActionPending.length > 0}
                    onClick={onGoogleTasksLinkStart}>
                    Re-link Google
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
            <p className="small profile-google-media-note">
              Choose one or more lists to sync tasks between Google and Family Chores.
            </p>
          </div>
        </div>
      </article>
    </section>
  );
}
