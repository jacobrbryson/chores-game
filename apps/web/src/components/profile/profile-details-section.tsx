import { Avatar } from "@/components/avatar";
import { Button } from "@/components/button";
import { EnumChip, humanizeEnum } from "@/components/enum-chip";
import type { ThemePalette } from "@/components/profile/profile-page.types";

type ProfileDetailsSectionProps = {
  displayName: string;
  displayEmail: string;
  role: "admin" | "player";
  isLoading: boolean;
  canEditName: boolean;
  isEditingName: boolean;
  editedName: string;
  namePending: boolean;
  nameError: string;
  picture?: string;
  activeAvatarId: string;
  activeAvatarPhotoUrl: string;
  themePalette: ThemePalette;
  activeThemeName: string;
  isDefaultThemeActive: boolean;
  activeConfettiName: string;
  isDefaultConfettiActive: boolean;
  activeConfettiColors: string[];
  onNameDraftChange: (value: string) => void;
  onStartNameEdit: () => void;
  onCancelNameEdit: () => void;
  onSaveNameEdit: () => void;
  onOpenAvatarDialog: () => void;
  onOpenThemeDialog: () => void;
  onOpenConfettiDialog: () => void;
};

export function ProfileDetailsSection({
  displayName,
  displayEmail,
  role,
  isLoading,
  canEditName,
  isEditingName,
  editedName,
  namePending,
  nameError,
  picture,
  activeAvatarId,
  activeAvatarPhotoUrl,
  themePalette,
  activeThemeName,
  isDefaultThemeActive,
  activeConfettiName,
  isDefaultConfettiActive,
  activeConfettiColors,
  onNameDraftChange,
  onStartNameEdit,
  onCancelNameEdit,
  onSaveNameEdit,
  onOpenAvatarDialog,
  onOpenThemeDialog,
  onOpenConfettiDialog,
}: ProfileDetailsSectionProps) {
  return (
    <section className="profile-page-grid">
      <article className="profile-page-avatar-card">
        <h2>Details</h2>
        <div className="profile-page-account-row">
          <div className="profile-page-account-avatar">
            <Avatar
              className="profile-page-avatar-frame"
              size={140}
              borderWidth={3}
              name={displayName}
              avatarId={activeAvatarId}
              photoUrl={activeAvatarPhotoUrl || picture || ""}
              primaryColor={themePalette.primary}
              secondaryColor={themePalette.primary}
              fallbackColor="#ffffff"
              referrerPolicy="no-referrer"
              loading="eager"
            />
            <div className="profile-avatar-actions">
              <Button
                type="button"
                className="btn btn-secondary profile-theme-change-btn"
                disabled={isLoading}
                onClick={onOpenAvatarDialog}>
                Change
              </Button>
            </div>
            {isLoading ? <p className="small">Loading avatar settings...</p> : null}
          </div>
          <dl className="profile-page-fields profile-page-basic-fields">
            <div>
              <dt>Name</dt>
              <dd className="profile-page-name-line">
                {isEditingName ? (
                  <div className="profile-name-edit-wrap">
                    <input
                      type="text"
                      value={editedName}
                      onChange={(event) => onNameDraftChange(event.target.value)}
                      className="profile-name-input"
                      maxLength={80}
                      disabled={namePending}
                      aria-label="Your name"
                    />
                    <div className="profile-name-actions">
                      <Button
                        type="button"
                        className="btn btn-primary profile-theme-change-btn"
                        disabled={namePending}
                        onClick={onSaveNameEdit}>
                        {namePending ? "Saving..." : "Save"}
                      </Button>
                      <Button
                        type="button"
                        className="btn btn-secondary profile-theme-change-btn"
                        disabled={namePending}
                        onClick={onCancelNameEdit}>
                        Cancel
                      </Button>
                    </div>
                    {nameError ? <span className="profile-name-error">{nameError}</span> : null}
                  </div>
                ) : (
                  <>
                    <span>{displayName}</span>
                    {canEditName ? (
                      <Button
                        type="button"
                        className="btn btn-secondary profile-theme-change-btn"
                        disabled={isLoading}
                        onClick={onStartNameEdit}>
                        Change
                      </Button>
                    ) : null}
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{displayEmail}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>
                <EnumChip label={humanizeEnum(role)} tone={role === "admin" ? "indigo" : "teal"} />
              </dd>
            </div>
          </dl>
        </div>
        <dl className="profile-page-fields profile-page-style-fields">
          <div>
            <dt>Theme</dt>
            <dd className="profile-page-theme-line">
              <span className="profile-page-theme-name">
                {activeThemeName}
                {isDefaultThemeActive ? " (default)" : ""}
              </span>
              <span className="profile-page-theme-swatches" aria-hidden="true">
                <span className="profile-theme-swatch" style={{ backgroundColor: themePalette.primary }} />
                <span className="profile-theme-swatch" style={{ backgroundColor: themePalette.secondary }} />
                <span className="profile-theme-swatch" style={{ backgroundColor: themePalette.tertiary }} />
              </span>
              <Button
                type="button"
                className="btn btn-secondary profile-theme-change-btn"
                disabled={isLoading}
                onClick={onOpenThemeDialog}>
                Change
              </Button>
            </dd>
          </div>
          <div>
            <dt>Victory Confetti</dt>
            <dd className="profile-page-theme-line">
              <span className="profile-page-theme-name">
                {activeConfettiName}
                {isDefaultConfettiActive ? " (default)" : ""}
              </span>
              {!isDefaultConfettiActive && activeConfettiColors.length > 0 ? (
                <span className="profile-page-theme-swatches" aria-hidden="true">
                  {activeConfettiColors.map((color, index) => (
                    <span key={`${color}-${index}`} className="profile-theme-swatch" style={{ backgroundColor: color }} />
                  ))}
                </span>
              ) : null}
              <Button
                type="button"
                className="btn btn-secondary profile-theme-change-btn"
                disabled={isLoading}
                onClick={onOpenConfettiDialog}>
                Change
              </Button>
            </dd>
          </div>
        </dl>
      </article>
    </section>
  );
}
