"use client";

import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { BackLink } from "@/components/back-link";
import { EnumChip, humanizeEnum } from "@/components/enum-chip";

type ProfilePageClientProps = {
  name: string;
  email: string;
  role: "admin" | "player";
  picture?: string;
};

type StoreProfileSummary = {
  dashboardPrimaryColor?: string;
  avatarId?: string;
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

export function ProfilePageClient({ name, email, role, picture }: ProfilePageClientProps) {
  const [storeSummary, setStoreSummary] = useState<StoreProfileSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function loadStoreSummary() {
      setIsLoading(true);
      setError("");
      try {
        const response = await fetch("/api/store", { cache: "no-store" });
        if (!response.ok) {
          const body = (await response.json()) as { error?: string };
          throw new Error(body.error ?? `PROFILE_STORE_HTTP_${response.status}`);
        }
        const payload = (await response.json()) as StoreProfileSummary;
        if (!active) {
          return;
        }
        setStoreSummary(payload);
      } catch (loadError) {
        if (!active) {
          return;
        }
        setStoreSummary(null);
        setError(loadError instanceof Error ? loadError.message : "profile_unavailable");
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void loadStoreSummary();
    return () => {
      active = false;
    };
  }, []);

  const dashboardPrimaryColor = useMemo(() => {
    const raw = storeSummary?.dashboardPrimaryColor?.trim().toLowerCase() ?? "";
    return raw || "#6b7280";
  }, [storeSummary?.dashboardPrimaryColor]);
  const hasCustomTheme = Boolean(storeSummary?.dashboardPrimaryColor?.trim());

  const avatarUrl = useMemo(() => {
    const avatarId = storeSummary?.avatarId?.trim();
    if (avatarId) {
      return `/avatars/default/${avatarId}.png`;
    }
    if (picture) {
      return picture;
    }
    return "";
  }, [storeSummary?.avatarId, picture]);

  const displayName = name || "Signed In User";
  const displayEmail = email || "-";

  return (
    <main className="panel family-page profile-page">
      <BackLink />
      <h1>Profile</h1>
      <p className="small family-page-subhead">Your account details and personalization settings.</p>

      {error ? <p className="small family-error">Could not load profile settings: {error}</p> : null}

      <section className="profile-page-grid">
        <article className="profile-page-avatar-card">
          <h2>Avatar</h2>
          <div className="profile-page-avatar-frame" style={{ "--profile-theme": dashboardPrimaryColor } as CSSProperties}>
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
                <span className="profile-theme-swatch" style={{ backgroundColor: dashboardPrimaryColor }} />
                <span className="profile-theme-swatch profile-theme-swatch-white" />
                <span>
                  {hasCustomTheme ? `${dashboardPrimaryColor} + white` : "gray + white (default)"}
                </span>
              </dd>
            </div>
          </dl>
        </article>
      </section>
    </main>
  );
}
