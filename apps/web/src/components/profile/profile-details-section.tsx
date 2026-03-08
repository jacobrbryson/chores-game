import { Avatar } from "@/components/avatar";
import { Button } from "@/components/button";
import { EnumChip, humanizeEnum } from "@/components/enum-chip";
import type { ThemePalette } from "@/components/profile/profile-page.types";
import type { ReactNode } from "react";

type ProfileDetailsSectionProps = {
  displayName: string;
  displayEmail: string;
  role: "admin" | "player";
  isLoading: boolean;
  picture?: string;
  activeAvatarId: string;
  activeAvatarPhotoUrl: string;
  themePalette: ThemePalette;
  activeThemeName: string;
  isDefaultThemeActive: boolean;
  activeConfettiName: string;
  isDefaultConfettiActive: boolean;
  activeConfettiColors: string[];
  onOpenAvatarDialog: () => void;
  onOpenThemeDialog: () => void;
  onOpenConfettiDialog: () => void;
  fallbackIcon: ReactNode;
};

export function ProfileDetailsSection({
  displayName,
  displayEmail,
  role,
  isLoading,
  picture,
  activeAvatarId,
  activeAvatarPhotoUrl,
  themePalette,
  activeThemeName,
  isDefaultThemeActive,
  activeConfettiName,
  isDefaultConfettiActive,
  activeConfettiColors,
  onOpenAvatarDialog,
  onOpenThemeDialog,
  onOpenConfettiDialog,
  fallbackIcon,
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
              secondaryColor={themePalette.secondary}
              referrerPolicy="no-referrer"
              loading="eager"
              fallbackClassName="profile-page-avatar-fallback"
              fallback={fallbackIcon}
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
              <dd>{displayName}</dd>
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
              <span className="profile-page-theme-swatches" aria-hidden="true">
                {activeConfettiColors.map((color, index) => (
                  <span key={`${color}-${index}`} className="profile-theme-swatch" style={{ backgroundColor: color }} />
                ))}
              </span>
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
