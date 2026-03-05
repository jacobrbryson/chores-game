"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Avatar } from "@/components/avatar";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/button";
import { EnumChip, humanizeEnum } from "@/components/enum-chip";
import { GoogleGIcon } from "@/components/google-g-icon";
import { ModalShell } from "@/components/modal-shell";
import { TailwindMultiSelect } from "@/components/tailwind-multi-select";
import type { TailwindSelectOption } from "@/components/tailwind-select";
import { dispatchConfettiSelectionChanged } from "@/lib/confetti/party";
import {
  DEFAULT_COLOR_THEME_OPTION_ID,
  DEFAULT_CONFETTI_OPTION_ID,
  isAllowedDashboardColor,
  normalizeColor,
  type StoreCategory,
  type StoreOption,
} from "@/lib/store/catalog";
import {
  DEFAULT_THEME_PREFERENCE,
  dispatchThemeChanged,
  isThemePreference,
  type ThemePreference,
} from "@/lib/theme/preferences";

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
  selectedConfettiOptionId?: string;
};

type GoogleTasksTaskListOption = {
  id: string;
  title: string;
  isDefault?: boolean;
};

type GoogleTasksProfileSummary = {
  linked: boolean;
  linkedAt?: string;
  lastSyncedAt?: string;
  lastSyncStatus?: "idle" | "ok" | "error";
  lastSyncError?: string;
  selectedTaskListIds?: string[];
  selectedTaskListTitles?: string[];
  selectedTaskListId?: string;
  selectedTaskListTitle?: string;
  taskLists?: GoogleTasksTaskListOption[];
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

function formatDateTime(value?: string) {
  if (!value) {
    return "Never";
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return "Never";
  }
  return new Date(parsed).toLocaleString();
}

function toThemePreference(option: StoreOption): ThemePreference | null {
  if (!option.theme) {
    return null;
  }
  const preference = {
    optionId: option.id,
    primary: option.theme.primary,
    secondary: option.theme.secondary,
    tertiary: option.theme.tertiary,
  };
  return isThemePreference(preference) ? preference : null;
}

export function ProfilePageClient({ name, email, role, picture }: ProfilePageClientProps) {
  const [storeSummary, setStoreSummary] = useState<StoreProfileSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [avatarDialogOpen, setAvatarDialogOpen] = useState(false);
  const [avatarActionPending, setAvatarActionPending] = useState("");
  const [avatarActionError, setAvatarActionError] = useState("");
  const [themeDialogOpen, setThemeDialogOpen] = useState(false);
  const [themeActionPending, setThemeActionPending] = useState("");
  const [themeActionError, setThemeActionError] = useState("");
  const [confettiDialogOpen, setConfettiDialogOpen] = useState(false);
  const [confettiActionPending, setConfettiActionPending] = useState("");
  const [confettiActionError, setConfettiActionError] = useState("");
  const [googleTasksSummary, setGoogleTasksSummary] = useState<GoogleTasksProfileSummary | null>(null);
  const [googleTasksLoading, setGoogleTasksLoading] = useState(true);
  const [googleTasksError, setGoogleTasksError] = useState("");
  const [googleTasksActionPending, setGoogleTasksActionPending] = useState("");
  const [googleTasksRedirectError, setGoogleTasksRedirectError] = useState("");

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

  const loadGoogleTasksSummary = useCallback(async () => {
    setGoogleTasksLoading(true);
    setGoogleTasksError("");
    try {
      const response = await fetch("/api/google-tasks", { cache: "no-store" });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `GOOGLE_TASKS_HTTP_${response.status}`);
      }
      const payload = (await response.json()) as GoogleTasksProfileSummary;
      setGoogleTasksSummary(payload);
    } catch (errorValue) {
      setGoogleTasksSummary(null);
      setGoogleTasksError(errorValue instanceof Error ? errorValue.message : "google_tasks_unavailable");
    } finally {
      setGoogleTasksLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStoreSummary();
    void loadGoogleTasksSummary();
  }, [loadGoogleTasksSummary, loadStoreSummary]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const searchParams = new URLSearchParams(window.location.search);
    const redirectError = searchParams.get("googleTasksError")?.trim() ?? "";
    if (redirectError) {
      setGoogleTasksRedirectError(redirectError);
    }
    const linkedFlag = searchParams.get("googleTasks");
    if (redirectError || linkedFlag) {
      searchParams.delete("googleTasksError");
      searchParams.delete("googleTasks");
      const nextQuery = searchParams.toString();
      const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`;
      window.history.replaceState(null, "", nextUrl);
    }
  }, []);

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

  const ownedSet = useMemo(() => new Set(storeSummary?.ownedOptionIds ?? []), [storeSummary?.ownedOptionIds]);
  const colorCategory = useMemo(
    () => storeSummary?.categories?.find((entry) => entry.id === "customize_colors") ?? null,
    [storeSummary?.categories],
  );
  const defaultThemeOption = useMemo(
    () =>
      (colorCategory?.options ?? []).find(
        (option) => option.id === DEFAULT_COLOR_THEME_OPTION_ID && Boolean(option.theme),
      ) ?? null,
    [colorCategory?.options],
  );
  const unlockedThemeOptions = useMemo(
    () =>
      (colorCategory?.options ?? []).filter(
        (option) =>
          Boolean(option.theme) &&
          (ownedSet.has(option.id) || option.id === DEFAULT_COLOR_THEME_OPTION_ID),
      ),
    [colorCategory?.options, ownedSet],
  );
  const activeThemeOptionId = storeSummary?.themeOptionId?.trim() ?? "";
  const activeThemeOption = useMemo(() => {
    const options = colorCategory?.options ?? [];
    const byId = options.find((option) => option.id === activeThemeOptionId && Boolean(option.theme));
    if (byId) {
      return byId;
    }
    const byPalette = options.find((option) => {
      if (!option.theme) {
        return false;
      }
      return (
        normalizeColor(option.theme.primary) === normalizeColor(themePalette.primary) &&
        normalizeColor(option.theme.secondary) === normalizeColor(themePalette.secondary) &&
        normalizeColor(option.theme.tertiary) === normalizeColor(themePalette.tertiary)
      );
    });
    if (byPalette) {
      return byPalette;
    }
    return defaultThemeOption;
  }, [
    activeThemeOptionId,
    colorCategory?.options,
    defaultThemeOption,
    themePalette.primary,
    themePalette.secondary,
    themePalette.tertiary,
  ]);
  const activeThemeName = activeThemeOption?.label ?? "Original Sky";
  const isDefaultThemeActive =
    (activeThemeOption?.id ?? DEFAULT_COLOR_THEME_OPTION_ID) === DEFAULT_COLOR_THEME_OPTION_ID;
  const confettiCategory = useMemo(
    () => storeSummary?.categories?.find((entry) => entry.id === "victory_confetti") ?? null,
    [storeSummary?.categories],
  );
  const defaultConfettiOption = useMemo(
    () =>
      (confettiCategory?.options ?? []).find(
        (option) => option.id === DEFAULT_CONFETTI_OPTION_ID || option.isDefault,
      ) ?? null,
    [confettiCategory?.options],
  );
  const unlockedConfettiOptions = useMemo(
    () =>
      (confettiCategory?.options ?? []).filter(
        (option) =>
          ownedSet.has(option.id) || option.id === DEFAULT_CONFETTI_OPTION_ID || option.isDefault === true,
      ),
    [confettiCategory?.options, ownedSet],
  );
  const activeConfettiOptionId = storeSummary?.selectedConfettiOptionId?.trim() ?? "";
  const activeConfettiOption = useMemo(() => {
    const options = confettiCategory?.options ?? [];
    return (
      options.find((option) => option.id === activeConfettiOptionId) ??
      defaultConfettiOption ??
      options[0] ??
      null
    );
  }, [activeConfettiOptionId, confettiCategory?.options, defaultConfettiOption]);
  const activeConfettiName = activeConfettiOption?.label ?? "No confetti";
  const isDefaultConfettiActive =
    (activeConfettiOption?.id ?? DEFAULT_CONFETTI_OPTION_ID) === DEFAULT_CONFETTI_OPTION_ID;
  const activeConfettiColors = (activeConfettiOption?.confetti?.colors ?? ["#cbd5e1", "#94a3b8", "#e2e8f0"]).slice(
    0,
    3,
  );
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

  async function applyThemeOption(option: StoreOption) {
    setThemeActionPending(option.id);
    setThemeActionError("");
    try {
      const response = await fetch("/api/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_theme", optionId: option.id }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `PROFILE_THEME_HTTP_${response.status}`);
      }
      const preference = toThemePreference(option);
      if (preference) {
        dispatchThemeChanged(preference);
      }
      await loadStoreSummary();
    } catch (errorValue) {
      setThemeActionError(errorValue instanceof Error ? errorValue.message : "theme_update_failed");
    } finally {
      setThemeActionPending("");
    }
  }

  function onApplyThemeOption(option: StoreOption) {
    void applyThemeOption(option);
  }

  async function applyConfettiOption(option: StoreOption) {
    setConfettiActionPending(option.id);
    setConfettiActionError("");
    try {
      const response = await fetch("/api/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_confetti", optionId: option.id }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `PROFILE_CONFETTI_HTTP_${response.status}`);
      }
      dispatchConfettiSelectionChanged(option.id);
      await loadStoreSummary();
    } catch (errorValue) {
      setConfettiActionError(errorValue instanceof Error ? errorValue.message : "confetti_update_failed");
    } finally {
      setConfettiActionPending("");
    }
  }

  function onApplyConfettiOption(option: StoreOption) {
    void applyConfettiOption(option);
  }

  async function applyGoogleTasksAction(body: Record<string, unknown>, pendingKey: string) {
    setGoogleTasksActionPending(pendingKey);
    setGoogleTasksError("");
    try {
      const response = await fetch("/api/google-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `GOOGLE_TASKS_ACTION_HTTP_${response.status}`);
      }
      await loadGoogleTasksSummary();
    } catch (errorValue) {
      setGoogleTasksError(errorValue instanceof Error ? errorValue.message : "google_tasks_action_failed");
    } finally {
      setGoogleTasksActionPending("");
    }
  }

  function onGoogleTasksSyncNow() {
    void applyGoogleTasksAction({ action: "sync_now" }, "sync_now");
  }

  function onGoogleTasksTaskListChange(taskListIds: string[]) {
    if (taskListIds.length === 0) {
      setGoogleTasksError("Select at least one Google task list.");
      return;
    }
    const pendingKey = `lists:${taskListIds.join(",")}`;
    void applyGoogleTasksAction({ action: "set_task_list", taskListIds }, pendingKey);
  }

  function onGoogleTasksUnlink() {
    void applyGoogleTasksAction({ action: "unlink" }, "unlink");
  }

  function onGoogleTasksLinkStart() {
    if (typeof window === "undefined") {
      return;
    }
    window.location.assign("/api/auth/google/tasks/start");
  }

  const displayName = name || "Signed In User";
  const displayEmail = email || "-";
  const googleTasksLinked = googleTasksSummary?.linked === true;
  const googleTaskLists = googleTasksSummary?.taskLists ?? [];
  const selectedGoogleTaskListIds =
    googleTasksSummary?.selectedTaskListIds && googleTasksSummary.selectedTaskListIds.length > 0
      ? googleTasksSummary.selectedTaskListIds
      : googleTasksSummary?.selectedTaskListId
        ? [googleTasksSummary.selectedTaskListId]
        : [];
  const selectedGoogleTaskListTitles =
    googleTasksSummary?.selectedTaskListTitles && googleTasksSummary.selectedTaskListTitles.length > 0
      ? googleTasksSummary.selectedTaskListTitles
      : googleTasksSummary?.selectedTaskListTitle
        ? [googleTasksSummary.selectedTaskListTitle]
        : selectedGoogleTaskListIds
            .map((id) => googleTaskLists.find((taskList) => taskList.id === id)?.title ?? "")
            .filter((title) => title.length > 0);
  const selectedGoogleTaskListSummary =
    selectedGoogleTaskListTitles.length > 0
      ? selectedGoogleTaskListTitles.join(", ")
      : "No task lists selected";
  const googleTaskListOptions: TailwindSelectOption<string>[] = useMemo(
    () =>
      googleTaskLists.map((taskList) => ({
        value: taskList.id,
        label: `${taskList.title}${taskList.isDefault ? " (default)" : ""}`,
      })),
    [googleTaskLists],
  );
  const googleTasksLastSyncedLabel = formatDateTime(googleTasksSummary?.lastSyncedAt);
  const googleTasksLastSyncStatus = googleTasksSummary?.lastSyncStatus ?? "idle";
  const googleTasksStatusLabel =
    googleTasksLastSyncStatus === "ok"
      ? "Healthy"
      : googleTasksLastSyncStatus === "error"
        ? "Needs attention"
        : "Not synced yet";

  return (
    <main className="panel family-page profile-page">
      <div className="page-header-row">
        <div className="page-header-inline">
          <BackLink className="page-back-link" />
          <h1>Profile</h1>
        </div>
      </div>
      <p className="small family-page-subhead">Your account details and personalization settings.</p>

      {error ? <p className="small family-error">Could not load profile settings: {error}</p> : null}

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
                fallback={<ProfileFallbackIcon />}
              />
              <div className="profile-avatar-actions">
                <Button
                  type="button"
                  className="btn btn-secondary profile-theme-change-btn"
                  disabled={isLoading}
                  onClick={() => {
                    setAvatarActionError("");
                    setAvatarDialogOpen(true);
                  }}>
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
                  onClick={() => {
                    setThemeActionError("");
                    setThemeDialogOpen(true);
                  }}>
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
                    <span
                      key={`${color}-${index}`}
                      className="profile-theme-swatch"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </span>
                <Button
                  type="button"
                  className="btn btn-secondary profile-theme-change-btn"
                  disabled={isLoading}
                  onClick={() => {
                    setConfettiActionError("");
                    setConfettiDialogOpen(true);
                  }}>
                  Change
                </Button>
              </dd>
            </div>
          </dl>
        </article>
      </section>

      <section className="profile-google-card-wrap">
        <article className="profile-page-google-card">
          <h2>Link with Google</h2>
          <div className="profile-google-content-grid">
            <div className="profile-google-content-copy">
              {googleTasksRedirectError ? (
                <p className="small family-error">
                  Could not finish Google link: {googleTasksRedirectError}
                </p>
              ) : null}
              {googleTasksError ? (
                <p className="small family-error">
                  Google Tasks update failed: {googleTasksError}
                </p>
              ) : null}
              {googleTasksLoading ? <p className="small">Loading Google link status...</p> : null}
              {!googleTasksLoading && !googleTasksLinked ? (
                <>
                  <p className="small">
                    Family Chores can link your profile to Google Tasks so your chore checklist stays in
                    sync with the Google tools your family already uses.
                  </p>
                  <p className="small">
                    Google Tasks can appear in Google Calendar when the task list is enabled there. You can
                    pick which Google task list this profile syncs with.
                  </p>
                  <p className="small profile-google-policy-alert">
                    Alert: syncing shares linked Google Tasks with all family members. Policy stays the
                    same: only admins can complete another family member&apos;s tasks.
                  </p>
                  <div className="profile-google-link-center-wrap">
                    <Button
                      type="button"
                      className="btn btn-primary profile-google-link-btn"
                      onClick={onGoogleTasksLinkStart}>
                      <GoogleGIcon className="profile-google-link-icon" />
                      Sign in with Google
                    </Button>
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
                  {googleTaskLists.length > 0 ? (
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
              <Avatar
                className="profile-avatar-option-preview"
                size={72}
                borderWidth={2}
                name={displayName}
                photoUrl={googleAvatarUrl}
                referrerPolicy="no-referrer"
                fallbackClassName="profile-page-avatar-fallback"
                fallback={<ProfileFallbackIcon />}
              />
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

      <ModalShell open={themeDialogOpen} onRequestClose={() => setThemeDialogOpen(false)}>
        <section className="profile-avatar-modal">
          <header className="profile-avatar-modal-header">
            <h3>Choose a theme from your collection</h3>
          </header>
          {themeActionError ? (
            <p className="small family-error">Could not update theme: {themeActionError}</p>
          ) : null}
          <div className="profile-avatar-option-list">
            {defaultThemeOption ? (
              <article className="profile-avatar-option-card">
                <div className="profile-theme-option-preview">
                  <span
                    className="profile-theme-swatch"
                    style={{ backgroundColor: defaultThemeOption.theme?.primary }}
                  />
                  <span
                    className="profile-theme-swatch"
                    style={{ backgroundColor: defaultThemeOption.theme?.secondary }}
                  />
                  <span
                    className="profile-theme-swatch"
                    style={{ backgroundColor: defaultThemeOption.theme?.tertiary }}
                  />
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
                      <strong>Unlocked {formatUnlockedDate(storeSummary?.unlockedOptionDates?.[option.id])}</strong>
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
          <header className="profile-avatar-modal-header">
            <h3>Choose a Victory Confetti style</h3>
          </header>
          {confettiActionError ? (
            <p className="small family-error">Could not update confetti: {confettiActionError}</p>
          ) : null}
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
                  disabled={
                    confettiActionPending.length > 0 || activeConfettiOption?.id === defaultConfettiOption.id
                  }
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
                      <strong>Unlocked {formatUnlockedDate(storeSummary?.unlockedOptionDates?.[option.id])}</strong>
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
    </main>
  );
}
