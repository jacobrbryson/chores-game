"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackLink } from "@/components/back-link";
import { ProfileCustomizationModals } from "@/components/profile/profile-customization-modals";
import { ProfileDetailsSection } from "@/components/profile/profile-details-section";
import { ProfileGoogleLinkCard } from "@/components/profile/profile-google-link-card";
import { deriveGoogleTasksView } from "@/components/profile/profile-google-tasks.utils";
import { postGoogleTasksAction, postStoreAction } from "@/components/profile/profile-page.api";
import {
  ProfileFallbackIcon,
  formatDateTime,
  toThemePreference,
} from "@/components/profile/profile-page.utils";
import type {
  GoogleTasksProfileSummary,
  ProfilePageClientProps,
  StoreProfileSummary,
} from "@/components/profile/profile-page.types";
import { dispatchConfettiSelectionChanged } from "@/lib/confetti/party";
import {
  DEFAULT_COLOR_THEME_OPTION_ID,
  DEFAULT_CONFETTI_OPTION_ID,
  isAllowedDashboardColor,
  normalizeColor,
  type StoreOption,
} from "@/lib/store/catalog";
import { DEFAULT_THEME_PREFERENCE, dispatchThemeChanged } from "@/lib/theme/preferences";

function normalizeTaskListIds(taskListIds: string[]) {
  return Array.from(
    new Set(
      taskListIds
        .map((taskListId) => taskListId.trim())
        .filter((taskListId) => taskListId.length > 0),
    ),
  ).sort();
}

function haveSameTaskListSelection(leftTaskListIds: string[], rightTaskListIds: string[]) {
  const left = normalizeTaskListIds(leftTaskListIds);
  const right = normalizeTaskListIds(rightTaskListIds);
  if (left.length !== right.length) {
    return false;
  }
  return left.every((taskListId, index) => taskListId === right[index]);
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
  const [googleTaskListSelectionDraft, setGoogleTaskListSelectionDraft] = useState<string[] | null>(null);
  const singleTaskListAutoSyncRef = useRef("");
  const postLinkAutoSyncPendingRef = useRef(false);

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
    if (linkedFlag === "linked") {
      postLinkAutoSyncPendingRef.current = true;
    }
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
        (option) => Boolean(option.theme) && (ownedSet.has(option.id) || option.id === DEFAULT_COLOR_THEME_OPTION_ID),
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
    return byPalette ?? defaultThemeOption;
  }, [activeThemeOptionId, colorCategory?.options, defaultThemeOption, themePalette]);

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
        (option) => ownedSet.has(option.id) || option.id === DEFAULT_CONFETTI_OPTION_ID || option.isDefault === true,
      ),
    [confettiCategory?.options, ownedSet],
  );
  const activeConfettiOptionId = storeSummary?.selectedConfettiOptionId?.trim() ?? "";
  const activeConfettiOption = useMemo(() => {
    const options = confettiCategory?.options ?? [];
    return options.find((option) => option.id === activeConfettiOptionId) ?? defaultConfettiOption ?? options[0] ?? null;
  }, [activeConfettiOptionId, confettiCategory?.options, defaultConfettiOption]);

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

  const activeThemeName = activeThemeOption?.label ?? "Original Sky";
  const isDefaultThemeActive =
    (activeThemeOption?.id ?? DEFAULT_COLOR_THEME_OPTION_ID) === DEFAULT_COLOR_THEME_OPTION_ID;
  const activeConfettiName = activeConfettiOption?.label ?? "No confetti";
  const isDefaultConfettiActive =
    (activeConfettiOption?.id ?? DEFAULT_CONFETTI_OPTION_ID) === DEFAULT_CONFETTI_OPTION_ID;
  const activeConfettiColors = (activeConfettiOption?.confetti?.colors ?? ["#cbd5e1", "#94a3b8", "#e2e8f0"]).slice(
    0,
    3,
  );

  async function applyAvatarAction(body: Record<string, unknown>, pendingKey: string) {
    setAvatarActionPending(pendingKey);
    setAvatarActionError("");
    try {
      await postStoreAction(body, "PROFILE_AVATAR_HTTP");
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

  async function applyThemeOption(option: StoreOption) {
    setThemeActionPending(option.id);
    setThemeActionError("");
    try {
      await postStoreAction({ action: "set_theme", optionId: option.id }, "PROFILE_THEME_HTTP");
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

  async function applyConfettiOption(option: StoreOption) {
    setConfettiActionPending(option.id);
    setConfettiActionError("");
    try {
      await postStoreAction({ action: "set_confetti", optionId: option.id }, "PROFILE_CONFETTI_HTTP");
      dispatchConfettiSelectionChanged(option.id);
      await loadStoreSummary();
    } catch (errorValue) {
      setConfettiActionError(errorValue instanceof Error ? errorValue.message : "confetti_update_failed");
    } finally {
      setConfettiActionPending("");
    }
  }

  const applyGoogleTasksAction = useCallback(
    async (body: Record<string, unknown>, pendingKey: string) => {
      setGoogleTasksActionPending(pendingKey);
      setGoogleTasksError("");
      try {
        await postGoogleTasksAction(body);
        await loadGoogleTasksSummary();
      } catch (errorValue) {
        setGoogleTasksError(errorValue instanceof Error ? errorValue.message : "google_tasks_action_failed");
      } finally {
        setGoogleTasksActionPending("");
      }
    },
    [loadGoogleTasksSummary],
  );

  const googleTasksView = useMemo(
    () => deriveGoogleTasksView(googleTasksSummary, formatDateTime),
    [googleTasksSummary],
  );

  const selectedGoogleTaskListIds = useMemo(
    () => normalizeTaskListIds(googleTasksView.selectedGoogleTaskListIds),
    [googleTasksView.selectedGoogleTaskListIds],
  );
  const hasMultipleGoogleTaskListOptions = googleTasksView.googleTaskListsLength > 1;
  const showGoogleTaskListPicker = hasMultipleGoogleTaskListOptions;
  const effectiveGoogleTaskListSelection = googleTaskListSelectionDraft ?? selectedGoogleTaskListIds;
  const hasGoogleTaskListSelectionChanged =
    showGoogleTaskListPicker &&
    googleTaskListSelectionDraft !== null &&
    !haveSameTaskListSelection(googleTaskListSelectionDraft, selectedGoogleTaskListIds);
  const showGoogleTasksSyncNow = hasGoogleTaskListSelectionChanged;

  useEffect(() => {
    if (googleTaskListSelectionDraft === null) {
      return;
    }
    if (
      !showGoogleTaskListPicker ||
      haveSameTaskListSelection(googleTaskListSelectionDraft, selectedGoogleTaskListIds)
    ) {
      setGoogleTaskListSelectionDraft(null);
    }
  }, [googleTaskListSelectionDraft, selectedGoogleTaskListIds, showGoogleTaskListPicker]);

  useEffect(() => {
    if (!postLinkAutoSyncPendingRef.current) {
      return;
    }
    if (googleTasksLoading || googleTasksActionPending.length > 0) {
      return;
    }
    if (!googleTasksView.googleTasksLinked) {
      return;
    }
    postLinkAutoSyncPendingRef.current = false;
    void applyGoogleTasksAction({ action: "sync_now" }, "sync_now");
  }, [
    applyGoogleTasksAction,
    googleTasksActionPending,
    googleTasksLoading,
    googleTasksView.googleTasksLinked,
  ]);

  useEffect(() => {
    if (!googleTasksView.googleTasksLinked) {
      singleTaskListAutoSyncRef.current = "";
      return;
    }
    if (googleTasksLoading || googleTasksActionPending.length > 0) {
      return;
    }
    if (googleTasksView.googleTaskListsLength !== 1) {
      singleTaskListAutoSyncRef.current = "";
      return;
    }
    const singleTaskListId = googleTasksView.googleTaskListOptions[0]?.value.trim() ?? "";
    if (!singleTaskListId) {
      return;
    }
    if (singleTaskListAutoSyncRef.current === singleTaskListId) {
      return;
    }
    if (selectedGoogleTaskListIds.length === 1 && selectedGoogleTaskListIds[0] === singleTaskListId) {
      singleTaskListAutoSyncRef.current = singleTaskListId;
      return;
    }
    singleTaskListAutoSyncRef.current = singleTaskListId;
    setGoogleTaskListSelectionDraft(null);
    void applyGoogleTasksAction({ action: "set_task_list", taskListIds: [singleTaskListId] }, "sync_now");
  }, [
    applyGoogleTasksAction,
    googleTasksActionPending,
    googleTasksLoading,
    googleTasksView.googleTaskListOptions,
    googleTasksView.googleTaskListsLength,
    googleTasksView.googleTasksLinked,
    selectedGoogleTaskListIds,
  ]);

  const displayName = name || "Signed In User";
  const displayEmail = email || "-";

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

      <ProfileDetailsSection
        displayName={displayName}
        displayEmail={displayEmail}
        role={role}
        isLoading={isLoading}
        picture={picture}
        activeAvatarId={activeAvatarId}
        activeAvatarPhotoUrl={activeAvatarPhotoUrl}
        themePalette={themePalette}
        activeThemeName={activeThemeName}
        isDefaultThemeActive={isDefaultThemeActive}
        activeConfettiName={activeConfettiName}
        isDefaultConfettiActive={isDefaultConfettiActive}
        activeConfettiColors={activeConfettiColors}
        onOpenAvatarDialog={() => {
          setAvatarActionError("");
          setAvatarDialogOpen(true);
        }}
        onOpenThemeDialog={() => {
          setThemeActionError("");
          setThemeDialogOpen(true);
        }}
        onOpenConfettiDialog={() => {
          setConfettiActionError("");
          setConfettiDialogOpen(true);
        }}
        fallbackIcon={<ProfileFallbackIcon />}
      />

      <ProfileGoogleLinkCard
        googleTasksRedirectError={googleTasksRedirectError}
        googleTasksError={googleTasksError}
        googleTasksLoading={googleTasksLoading}
        googleTasksLinked={googleTasksView.googleTasksLinked}
        selectedGoogleTaskListSummary={googleTasksView.selectedGoogleTaskListSummary}
        googleTasksLastSyncedLabel={googleTasksView.googleTasksLastSyncedLabel}
        googleTasksStatusLabel={googleTasksView.googleTasksStatusLabel}
        googleTaskListsLength={googleTasksView.googleTaskListsLength}
        googleTaskListOptions={googleTasksView.googleTaskListOptions}
        selectedGoogleTaskListIds={effectiveGoogleTaskListSelection}
        showGoogleTaskListPicker={showGoogleTaskListPicker}
        showGoogleTasksSyncNow={showGoogleTasksSyncNow}
        googleTasksActionPending={googleTasksActionPending}
        googleTasksSummary={googleTasksSummary}
        onGoogleTasksLinkStart={() => {
          if (typeof window !== "undefined") {
            window.location.assign("/api/auth/google/tasks/start");
          }
        }}
        onGoogleTasksTaskListChange={(taskListIds) => {
          const normalizedTaskListIds = normalizeTaskListIds(taskListIds);
          if (normalizedTaskListIds.length === 0) {
            setGoogleTasksError("Select at least one Google task list.");
            return;
          }
          setGoogleTasksError("");
          setGoogleTaskListSelectionDraft(normalizedTaskListIds);
        }}
        onGoogleTasksSyncNow={() => {
          if (!hasGoogleTaskListSelectionChanged || !googleTaskListSelectionDraft) {
            return;
          }
          void applyGoogleTasksAction(
            { action: "set_task_list", taskListIds: googleTaskListSelectionDraft },
            "sync_now",
          );
        }}
        onGoogleTasksForceResync={() => {
          void applyGoogleTasksAction({ action: "sync_now" }, "force_sync_now");
        }}
        onGoogleTasksUnlink={() => {
          void applyGoogleTasksAction({ action: "unlink" }, "unlink");
        }}
      />

      <ProfileCustomizationModals
        avatarDialogOpen={avatarDialogOpen}
        setAvatarDialogOpen={setAvatarDialogOpen}
        avatarActionError={avatarActionError}
        avatarActionPending={avatarActionPending}
        displayName={displayName}
        googleAvatarUrl={googleAvatarUrl}
        usingGoogleAvatar={usingGoogleAvatar}
        unlockedAvatarOptions={unlockedAvatarOptions}
        activeAvatarId={activeAvatarId}
        unlockedOptionDates={storeSummary?.unlockedOptionDates}
        onApplyGoogleAvatar={() => {
          void applyAvatarAction({ action: "set_google_avatar" }, "google");
        }}
        onApplyUnlockedAvatar={(option) => {
          void applyAvatarAction({ action: "set_avatar", avatarId: option.value }, option.id);
        }}
        themeDialogOpen={themeDialogOpen}
        setThemeDialogOpen={setThemeDialogOpen}
        themeActionError={themeActionError}
        themeActionPending={themeActionPending}
        defaultThemeOption={defaultThemeOption}
        activeThemeOption={activeThemeOption}
        unlockedThemeOptions={unlockedThemeOptions}
        onApplyThemeOption={(option) => {
          void applyThemeOption(option);
        }}
        confettiDialogOpen={confettiDialogOpen}
        setConfettiDialogOpen={setConfettiDialogOpen}
        confettiActionError={confettiActionError}
        confettiActionPending={confettiActionPending}
        defaultConfettiOption={defaultConfettiOption}
        activeConfettiOption={activeConfettiOption}
        unlockedConfettiOptions={unlockedConfettiOptions}
        onApplyConfettiOption={(option) => {
          void applyConfettiOption(option);
        }}
        fallbackIcon={<ProfileFallbackIcon />}
      />
    </main>
  );
}

