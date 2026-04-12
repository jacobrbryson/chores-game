import Link from "next/link";
import type { ReactNode } from "react";
import { Alert } from "@/components/alert";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/button";
import { ModalShell } from "@/components/modal-shell";
import {
  DEFAULT_COLOR_THEME_OPTION_ID,
  DEFAULT_CONFETTI_OPTION_ID,
  type StoreOption,
} from "@/lib/store/catalog";
import { formatUnlockedDate } from "@/components/profile/profile-page.utils";

type ProfileCustomizationModalsProps = {
  avatarDialogOpen: boolean;
  setAvatarDialogOpen: (open: boolean) => void;
  avatarActionError: string;
  avatarActionPending: string;
  displayName: string;
  googleAvatarUrl: string;
  usingGoogleAvatar: boolean;
  unlockedAvatarOptions: StoreOption[];
  activeAvatarId: string;
  unlockedOptionDates?: Record<string, string>;
  onApplyGoogleAvatar: () => void;
  onApplyUnlockedAvatar: (option: StoreOption) => void;

  themeDialogOpen: boolean;
  setThemeDialogOpen: (open: boolean) => void;
  themeActionError: string;
  themeActionPending: string;
  defaultThemeOption: StoreOption | null;
  activeThemeOption: StoreOption | null;
  unlockedThemeOptions: StoreOption[];
  onApplyThemeOption: (option: StoreOption) => void;

  confettiDialogOpen: boolean;
  setConfettiDialogOpen: (open: boolean) => void;
  confettiActionError: string;
  confettiActionPending: string;
  defaultConfettiOption: StoreOption | null;
  activeConfettiOption: StoreOption | null;
  unlockedConfettiOptions: StoreOption[];
  onApplyConfettiOption: (option: StoreOption) => void;

  fallbackIcon: ReactNode;
};

export function ProfileCustomizationModals({
  avatarDialogOpen,
  setAvatarDialogOpen,
  avatarActionError,
  avatarActionPending,
  displayName,
  googleAvatarUrl,
  usingGoogleAvatar,
  unlockedAvatarOptions,
  activeAvatarId,
  unlockedOptionDates,
  onApplyGoogleAvatar,
  onApplyUnlockedAvatar,

  themeDialogOpen,
  setThemeDialogOpen,
  themeActionError,
  themeActionPending,
  defaultThemeOption,
  activeThemeOption,
  unlockedThemeOptions,
  onApplyThemeOption,

  confettiDialogOpen,
  setConfettiDialogOpen,
  confettiActionError,
  confettiActionPending,
  defaultConfettiOption,
  activeConfettiOption,
  unlockedConfettiOptions,
  onApplyConfettiOption,

  fallbackIcon,
}: ProfileCustomizationModalsProps) {
  return (
    <>
      <ModalShell open={avatarDialogOpen} onRequestClose={() => setAvatarDialogOpen(false)}>
        <section className="profile-avatar-modal">
          <header className="profile-avatar-modal-header modal-dialog-title-row">
            <h3>Choose an avatar from your collection</h3>
            <Button
              type="button"
              className="modal-close-button"
              onClick={() => setAvatarDialogOpen(false)}
              aria-label="Close dialog"
              title="Close dialog">
              X
            </Button>
          </header>
          {avatarActionError ? <Alert>Could not update avatar: {avatarActionError}</Alert> : null}
          <div className="profile-avatar-option-list">
            <article className="profile-avatar-option-card">
              <Avatar
                className="profile-avatar-option-preview"
                size={72}
                borderWidth={2}
                name={displayName}
                photoUrl={googleAvatarUrl}
                referrerPolicy="no-referrer"
                fallbackClassName="profile-page-avatar-fallback"
                fallback={fallbackIcon}
              />
              <h4>
                <span className="small">(default)</span>
              </h4>
              <Button
                type="button"
                className="btn btn-primary"
                disabled={avatarActionPending.length > 0 || usingGoogleAvatar}
                onClick={onApplyGoogleAvatar}>
                {avatarActionPending === "google" ? "Saving..." : usingGoogleAvatar ? "Applied" : "Use"}
              </Button>
            </article>
            {unlockedAvatarOptions.map((option) => {
              const isApplied = activeAvatarId === option.value;
              return (
                <article key={option.id} className="profile-avatar-option-card">
                  <Avatar
                    className="profile-avatar-option-preview"
                    size={72}
                    borderWidth={2}
                    name={option.label}
                    avatarId={option.value}
                    alt={option.label}
                  />
                  <h4 className="profile-avatar-unlock-meta">
                    <span>Unlocked</span>
                    <strong>{formatUnlockedDate(unlockedOptionDates?.[option.id])}</strong>
                  </h4>
                  <Button
                    type="button"
                    className="btn btn-primary"
                    disabled={avatarActionPending.length > 0 || isApplied}
                    onClick={() => onApplyUnlockedAvatar(option)}>
                    {avatarActionPending === option.id ? "Saving..." : isApplied ? "Applied" : "Use"}
                  </Button>
                </article>
              );
            })}
          </div>
          <div className="profile-avatar-modal-actions">
            <Link
              href="/store?category=customize_avatar"
              className="btn btn-secondary"
              onClick={() => setAvatarDialogOpen(false)}>
              Unlock more in shop
            </Link>
            <Button
              type="button"
              className="btn btn-secondary"
              disabled={avatarActionPending.length > 0}
              onClick={() => setAvatarDialogOpen(false)}>
              Close
            </Button>
          </div>
        </section>
      </ModalShell>

      <ModalShell open={themeDialogOpen} onRequestClose={() => setThemeDialogOpen(false)}>
        <section className="profile-avatar-modal">
          <header className="profile-avatar-modal-header modal-dialog-title-row">
            <h3>Choose a theme from your collection</h3>
            <Button
              type="button"
              className="modal-close-button"
              onClick={() => setThemeDialogOpen(false)}
              aria-label="Close dialog"
              title="Close dialog">
              X
            </Button>
          </header>
          {themeActionError ? <Alert>Could not update theme: {themeActionError}</Alert> : null}
          <div className="profile-avatar-option-list">
            {defaultThemeOption ? (
              <article className="profile-avatar-option-card">
                <div className="profile-theme-option-preview">
                  <span className="profile-theme-swatch" style={{ backgroundColor: defaultThemeOption.theme?.primary }} />
                  <span className="profile-theme-swatch" style={{ backgroundColor: defaultThemeOption.theme?.secondary }} />
                  <span className="profile-theme-swatch" style={{ backgroundColor: defaultThemeOption.theme?.tertiary }} />
                </div>
                <h4 className="profile-avatar-unlock-meta">
                  <span>{defaultThemeOption.label}</span>
                  <strong>Default theme</strong>
                </h4>
                <Button
                  type="button"
                  className="btn btn-primary"
                  disabled={themeActionPending.length > 0 || activeThemeOption?.id === defaultThemeOption.id}
                  onClick={() => onApplyThemeOption(defaultThemeOption)}>
                  {themeActionPending === defaultThemeOption.id
                    ? "Saving..."
                    : activeThemeOption?.id === defaultThemeOption.id
                      ? "Applied"
                      : "Return to default"}
                </Button>
              </article>
            ) : null}
            {unlockedThemeOptions
              .filter((option) => option.id !== DEFAULT_COLOR_THEME_OPTION_ID)
              .map((option) => {
                const isApplied = activeThemeOption?.id === option.id;
                return (
                  <article key={option.id} className="profile-avatar-option-card">
                    <div className="profile-theme-option-preview">
                      <span className="profile-theme-swatch" style={{ backgroundColor: option.theme?.primary }} />
                      <span className="profile-theme-swatch" style={{ backgroundColor: option.theme?.secondary }} />
                      <span className="profile-theme-swatch" style={{ backgroundColor: option.theme?.tertiary }} />
                    </div>
                    <h4 className="profile-avatar-unlock-meta">
                      <span>{option.label}</span>
                      <strong>Unlocked {formatUnlockedDate(unlockedOptionDates?.[option.id])}</strong>
                    </h4>
                    <Button
                      type="button"
                      className="btn btn-primary"
                      disabled={themeActionPending.length > 0 || isApplied}
                      onClick={() => onApplyThemeOption(option)}>
                      {themeActionPending === option.id ? "Saving..." : isApplied ? "Applied" : "Use"}
                    </Button>
                  </article>
                );
              })}
          </div>
          <div className="profile-avatar-modal-actions">
            <Link
              href="/store?category=customize_colors"
              className="btn btn-secondary"
              onClick={() => setThemeDialogOpen(false)}>
              Go to store
            </Link>
            <Button
              type="button"
              className="btn btn-secondary"
              disabled={themeActionPending.length > 0}
              onClick={() => setThemeDialogOpen(false)}>
              Close
            </Button>
          </div>
        </section>
      </ModalShell>

      <ModalShell open={confettiDialogOpen} onRequestClose={() => setConfettiDialogOpen(false)}>
        <section className="profile-avatar-modal">
          <header className="profile-avatar-modal-header modal-dialog-title-row">
            <h3>Choose a Victory Confetti style</h3>
            <Button
              type="button"
              className="modal-close-button"
              onClick={() => setConfettiDialogOpen(false)}
              aria-label="Close dialog"
              title="Close dialog">
              X
            </Button>
          </header>
          {confettiActionError ? <Alert>Could not update confetti: {confettiActionError}</Alert> : null}
          <div className="profile-avatar-option-list">
            {defaultConfettiOption ? (
              <article className="profile-avatar-option-card">
                <div className="profile-theme-option-preview">
                  {(defaultConfettiOption.confetti?.colors ?? ["#cbd5e1", "#94a3b8", "#e2e8f0"])
                    .slice(0, 3)
                    .map((color, index) => (
                      <span
                        key={`${defaultConfettiOption.id}-${color}-${index}`}
                        className="profile-theme-swatch"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                </div>
                <h4 className="profile-avatar-unlock-meta">
                  <span>{defaultConfettiOption.label}</span>
                  <strong>Default style</strong>
                </h4>
                <Button
                  type="button"
                  className="btn btn-primary"
                  disabled={confettiActionPending.length > 0 || activeConfettiOption?.id === defaultConfettiOption.id}
                  onClick={() => onApplyConfettiOption(defaultConfettiOption)}>
                  {confettiActionPending === defaultConfettiOption.id
                    ? "Saving..."
                    : activeConfettiOption?.id === defaultConfettiOption.id
                      ? "Applied"
                      : "Return to default"}
                </Button>
              </article>
            ) : null}
            {unlockedConfettiOptions
              .filter((option) => option.id !== DEFAULT_CONFETTI_OPTION_ID)
              .map((option) => {
                const isApplied = activeConfettiOption?.id === option.id;
                const previewColors = (option.confetti?.colors ?? ["#cbd5e1", "#94a3b8", "#e2e8f0"]).slice(0, 3);
                return (
                  <article key={option.id} className="profile-avatar-option-card">
                    <div className="profile-theme-option-preview">
                      {previewColors.map((color, index) => (
                        <span
                          key={`${option.id}-${color}-${index}`}
                          className="profile-theme-swatch"
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                    <h4 className="profile-avatar-unlock-meta">
                      <span>{option.label}</span>
                      <strong>Unlocked {formatUnlockedDate(unlockedOptionDates?.[option.id])}</strong>
                    </h4>
                    <Button
                      type="button"
                      className="btn btn-primary"
                      disabled={confettiActionPending.length > 0 || isApplied}
                      onClick={() => onApplyConfettiOption(option)}>
                      {confettiActionPending === option.id ? "Saving..." : isApplied ? "Applied" : "Use"}
                    </Button>
                  </article>
                );
              })}
          </div>
          <div className="profile-avatar-modal-actions">
            <Link
              href="/store?category=victory_confetti"
              className="btn btn-secondary"
              onClick={() => setConfettiDialogOpen(false)}>
              Go to store
            </Link>
            <Button
              type="button"
              className="btn btn-secondary"
              disabled={confettiActionPending.length > 0}
              onClick={() => setConfettiDialogOpen(false)}>
              Close
            </Button>
          </div>
        </section>
      </ModalShell>
    </>
  );
}

