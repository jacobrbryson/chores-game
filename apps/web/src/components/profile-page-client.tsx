"use client";

import Link from "next/link";
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/button";
import { EnumChip, humanizeEnum } from "@/components/enum-chip";
import { ModalShell } from "@/components/modal-shell";
import { isAllowedDashboardColor, type StoreCategory, type StoreOption } from "@/lib/store/catalog";
import { DEFAULT_THEME_PREFERENCE } from "@/lib/theme/preferences";

type ProfilePageClientProps = {
  name: string;
  email: string;
  role: "admin" | "player";
  picture?: string;
};

type StoreProfileSummary = {
  ownedOptionIds?: string[];
  unlockedOptionDates?: Record<string, string>;
  categories?: StoreCategory[];
  dashboardPrimaryColor?: string;
  themeOptionId?: string;
  themePrimaryColor?: string;
  themeSecondaryColor?: string;
  themeTertiaryColor?: string;
  avatarId?: string;
  avatarPhotoUrl?: string;
  googlePhotoUrl?: string;
};

function ProfileFallbackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="profile-page-avatar-icon">
      <path
        d="M12 12.2a4.1 4.1 0 1 0 0-8.2 4.1 4.1 0 0 0 0 8.2Zm0 1.9c-3.98 0-7.2 2.56-7.2 5.7 0 .44.36.8.8.8h12.8a.8.8 0 0 0 .8-.8c0-3.14-3.22-5.7-7.2-5.7Z"
        fill="currentColor"
      />
    </svg>
  );
}

function formatUnlockedDate(value?: string) {
  if (!value) {
    return "Unknown";
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return "Unknown";
  }
  return new Date(parsed).toLocaleDateString();
}

export function ProfilePageClient({ name, email, role, picture }: ProfilePageClientProps) {
  const [storeSummary, setStoreSummary] = useState<StoreProfileSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [avatarDialogOpen, setAvatarDialogOpen] = useState(false);
  const [avatarActionPending, setAvatarActionPending] = useState("");
  const [avatarActionError, setAvatarActionError] = useState("");

  const loadStoreSummary = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/store", { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `PROFILE_STORE_HTTP_${response.status}`);
      }
      const payload = (await response.json()) as StoreProfileSummary;
      setStoreSummary(payload);
    } catch (loadError) {
      setStoreSummary(null);
      setError(loadError instanceof Error ? loadError.message : "profile_unavailable");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStoreSummary();
  }, [loadStoreSummary]);

  const themePalette = useMemo(() => {
    const primary = storeSummary?.themePrimaryColor?.trim().toLowerCase() ?? "";
    const secondary = storeSummary?.themeSecondaryColor?.trim().toLowerCase() ?? "";
    const tertiary = storeSummary?.themeTertiaryColor?.trim().toLowerCase() ?? "";
    if (
      isAllowedDashboardColor(primary) &&
      isAllowedDashboardColor(secondary) &&
      isAllowedDashboardColor(tertiary)
    ) {
      return { primary, secondary, tertiary };
    }
    const fallback = storeSummary?.dashboardPrimaryColor?.trim().toLowerCase() ?? "";
    if (isAllowedDashboardColor(fallback)) {
      return {
        primary: fallback,
        secondary: DEFAULT_THEME_PREFERENCE.secondary,
        tertiary: DEFAULT_THEME_PREFERENCE.tertiary,
      };
    }
    return {
      primary: DEFAULT_THEME_PREFERENCE.primary,
      secondary: DEFAULT_THEME_PREFERENCE.secondary,
      tertiary: DEFAULT_THEME_PREFERENCE.tertiary,
    };
  }, [
    storeSummary?.dashboardPrimaryColor,
    storeSummary?.themePrimaryColor,
    storeSummary?.themeSecondaryColor,
    storeSummary?.themeTertiaryColor,
  ]);

  const hasCustomTheme = Boolean(storeSummary?.themeOptionId?.trim());
  const ownedSet = useMemo(() => new Set(storeSummary?.ownedOptionIds ?? []), [storeSummary?.ownedOptionIds]);
  const avatarCategory = useMemo(
    () => storeSummary?.categories?.find((entry) => entry.id === "customize_avatar") ?? null,
    [storeSummary?.categories],
  );
  const unlockedAvatarOptions = useMemo(
    () => (avatarCategory?.options ?? []).filter((option) => ownedSet.has(option.id)),
    [avatarCategory?.options, ownedSet],
  );

  const googleAvatarUrl = (storeSummary?.googlePhotoUrl ?? picture ?? "").trim();
  const activeAvatarId = storeSummary?.avatarId?.trim() ?? "";
  const activeAvatarPhotoUrl = storeSummary?.avatarPhotoUrl?.trim() ?? "";
  const usingGoogleAvatar = !activeAvatarId && Boolean(activeAvatarPhotoUrl);

  const avatarUrl = useMemo(() => {
    if (activeAvatarId) {
      return `/avatars/default/${encodeURIComponent(activeAvatarId)}`;
    }
    if (activeAvatarPhotoUrl) {
      return activeAvatarPhotoUrl;
    }
    if (picture) {
      return picture;
    }
    return "";
  }, [activeAvatarId, activeAvatarPhotoUrl, picture]);

  async function applyAvatarAction(body: Record<string, unknown>, pendingKey: string) {
    setAvatarActionPending(pendingKey);
    setAvatarActionError("");
    try {
      const response = await fetch("/api/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `PROFILE_AVATAR_HTTP_${response.status}`);
      }
      await loadStoreSummary();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("profile-avatar:refresh"));
      }
    } catch (errorValue) {
      setAvatarActionError(errorValue instanceof Error ? errorValue.message : "avatar_update_failed");
    } finally {
      setAvatarActionPending("");
    }
  }

  function onApplyGoogleAvatar() {
    void applyAvatarAction({ action: "set_google_avatar" }, "google");
  }

  function onApplyUnlockedAvatar(option: StoreOption) {
    void applyAvatarAction({ action: "set_avatar", avatarId: option.value }, option.id);
  }

  const displayName = name || "Signed In User";
  const displayEmail = email || "-";

  return (
    <main className="panel family-page profile-page">
      <div className="page-header-row">
        <div className="page-header-inline">
          <BackLink className="page-back-link">{"<- Back"}</BackLink>
          <h1>Profile</h1>
        </div>
      </div>
      <p className="small family-page-subhead">Your account details and personalization settings.</p>

      {error ? <p className="small family-error">Could not load profile settings: {error}</p> : null}

      <section className="profile-page-grid">
        <article className="profile-page-avatar-card">
          <h2>Avatar</h2>
          <div className="profile-page-avatar-frame" style={{ "--profile-theme": themePalette.primary } as CSSProperties}>
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="profile-page-avatar-image"
                src={avatarUrl}
                alt={`${displayName} avatar`}
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="profile-page-avatar-fallback" aria-label="Default user avatar">
                <ProfileFallbackIcon />
              </span>
            )}
          </div>
          <div className="profile-avatar-actions">
            <Button
              type="button"
              className="btn btn-secondary"
              disabled={isLoading}
              onClick={() => {
                setAvatarActionError("");
                setAvatarDialogOpen(true);
              }}>
              Change
            </Button>
          </div>
          {isLoading ? <p className="small">Loading avatar settings...</p> : null}
        </article>

        <article className="profile-page-info-card">
          <h2>Details</h2>
          <dl className="profile-page-fields">
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
            <div>
              <dt>Theme</dt>
              <dd className="profile-page-theme-line">
                <span className="profile-theme-swatch" style={{ backgroundColor: themePalette.primary }} />
                <span className="profile-theme-swatch" style={{ backgroundColor: themePalette.secondary }} />
                <span className="profile-theme-swatch" style={{ backgroundColor: themePalette.tertiary }} />
                <span>
                  {hasCustomTheme
                    ? `${themePalette.primary} - ${themePalette.secondary} - ${themePalette.tertiary}`
                    : "Original Sky theme"}
                </span>
              </dd>
            </div>
          </dl>
        </article>
      </section>

      <ModalShell open={avatarDialogOpen} onRequestClose={() => setAvatarDialogOpen(false)}>
        <section className="profile-avatar-modal">
          <header className="profile-avatar-modal-header">
            <h3>Choose an avatar from your collection</h3>
          </header>
          {avatarActionError ? (
            <p className="small family-error">Could not update avatar: {avatarActionError}</p>
          ) : null}
          <div className="profile-avatar-option-list">
            <article className="profile-avatar-option-card">
              <div className="profile-avatar-option-preview">
                {googleAvatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="profile-page-avatar-image"
                    src={googleAvatarUrl}
                    alt="Google login avatar"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="profile-page-avatar-fallback" aria-label="Default user avatar">
                    <ProfileFallbackIcon />
                  </span>
                )}
              </div>
              <h4>
                <span className="small">(default)</span>
              </h4>
              <Button
                type="button"
                className="btn btn-primary"
                disabled={avatarActionPending.length > 0 || usingGoogleAvatar}
                onClick={onApplyGoogleAvatar}>
                {avatarActionPending === "google"
                  ? "Saving..."
                  : usingGoogleAvatar
                    ? "Applied"
                    : "Use"}
              </Button>
            </article>
            {unlockedAvatarOptions.map((option) => {
              const isApplied = activeAvatarId === option.value;
              return (
                <article key={option.id} className="profile-avatar-option-card">
                  <div className="profile-avatar-option-preview">
                    <img
                      className="profile-page-avatar-image"
                      src={`/avatars/default/${encodeURIComponent(option.value)}`}
                      alt={option.label}
                    />
                  </div>
                  <h4 className="profile-avatar-unlock-meta">
                    <span>Unlocked</span>
                    <strong>{formatUnlockedDate(storeSummary?.unlockedOptionDates?.[option.id])}</strong>
                  </h4>
                  <Button
                    type="button"
                    className="btn btn-primary"
                    disabled={avatarActionPending.length > 0 || isApplied}
                    onClick={() => onApplyUnlockedAvatar(option)}>
                    {avatarActionPending === option.id
                      ? "Saving..."
                      : isApplied
                        ? "Applied"
                        : "Use"}
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
    </main>
  );
}
