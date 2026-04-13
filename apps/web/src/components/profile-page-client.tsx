"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "@/components/alert";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/button";
import { GoogleSignInButton } from "@/components/google-signin-button";
import { ProfileCustomizationModals } from "@/components/profile/profile-customization-modals";
import { ProfileDetailsSection } from "@/components/profile/profile-details-section";
import { ProfileGoogleLinkCard } from "@/components/profile/profile-google-link-card";
import { deriveGoogleTasksView } from "@/components/profile/profile-google-tasks.utils";
import {
  patchProfileAction,
  postGoogleTasksAction,
  postStoreAction,
} from "@/components/profile/profile-page.api";
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
import { readStoredConfettiOptionId } from "@/lib/confetti/party";
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

export function ProfilePageClient({
  name,
  email,
  role,
  picture,
  isSwitched = false,
  authenticatedName = "",
}: ProfilePageClientProps) {
  const [storeSummary, setStoreSummary] = useState<StoreProfileSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [storedConfettiOptionId, setStoredConfettiOptionId] = useState(DEFAULT_CONFETTI_OPTION_ID);

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
  const [googleAccountRedirectError, setGoogleAccountRedirectError] = useState("");
  const [googleAccountLinkedMessage, setGoogleAccountLinkedMessage] = useState("");
  const [googleTaskListSelectionDraft, setGoogleTaskListSelectionDraft] = useState<string[] | null>(null);
  const singleTaskListAutoSyncRef = useRef("");
  const postLinkAutoSyncPendingRef = useRef(false);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinPending, setPinPending] = useState(false);
  const [pinError, setPinError] = useState("");
  const [pinSuccess, setPinSuccess] = useState("");
  const [displayName, setDisplayName] = useState(name || "Signed In User");
  const [editedName, setEditedName] = useState(name || "");
  const [isEditingName, setIsEditingName] = useState(false);
  const [namePending, setNamePending] = useState(false);
  const [nameError, setNameError] = useState("");

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
    setStoredConfettiOptionId(readStoredConfettiOptionId());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const searchParams = new URLSearchParams(window.location.search);
    const redirectError = searchParams.get("googleTasksError")?.trim() ?? "";
    if (redirectError) {
      setGoogleTasksRedirectError(redirectError);
    }
    const googleAccountError = searchParams.get("googleAccountError")?.trim() ?? "";
    if (googleAccountError) {
      setGoogleAccountRedirectError(googleAccountError);
    }
    const googleAccountStatus = searchParams.get("googleAccount")?.trim() ?? "";
    if (googleAccountStatus === "linked") {
      setGoogleAccountLinkedMessage("Google account linked.");
    }
    const linkedFlag = searchParams.get("googleTasks");
    if (linkedFlag === "linked") {
      postLinkAutoSyncPendingRef.current = true;
    }
    if (redirectError || linkedFlag || googleAccountError || googleAccountStatus) {
      searchParams.delete("googleTasksError");
      searchParams.delete("googleTasks");
      searchParams.delete("googleAccountError");
      searchParams.delete("googleAccount");
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
  const effectiveConfettiOptionId =
    storedConfettiOptionId &&
    unlockedConfettiOptions.some((option) => option.id === storedConfettiOptionId)
      ? storedConfettiOptionId
      : activeConfettiOptionId;
  const activeConfettiOption = useMemo(() => {
    const options = confettiCategory?.options ?? [];
    return options.find((option) => option.id === effectiveConfettiOptionId) ?? defaultConfettiOption ?? options[0] ?? null;
  }, [confettiCategory?.options, defaultConfettiOption, effectiveConfettiOptionId]);

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
  const googleAccountLinked = googleTasksSummary?.accountLinked === true;
  const googleClientId =
    typeof process !== "undefined" ? process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "" : "";
  const googleAccountLinkUri = "/api/auth/google/gsi?intent=link_account";

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

  const displayEmail = email || "-";

  useEffect(() => {
    const nextName = name || "Signed In User";
    setDisplayName(nextName);
    setEditedName(name || "");
    setIsEditingName(false);
    setNameError("");
  }, [name]);

  async function onSaveNameEdit() {
    const trimmedName = editedName.trim();
    if (trimmedName.length < 2 || trimmedName.length > 80) {
      setNameError("Name must be between 2 and 80 characters.");
      return;
    }
    if (trimmedName === displayName.trim()) {
      setIsEditingName(false);
      setNameError("");
      setEditedName(trimmedName);
      return;
    }

    setNamePending(true);
    setNameError("");
    try {
      const payload = await patchProfileAction({ name: trimmedName });
      const savedName = payload.name?.trim() || trimmedName;
      setDisplayName(savedName);
      setEditedName(savedName);
      setIsEditingName(false);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("profile-name:refresh", { detail: { name: savedName } }));
      }
    } catch (errorValue) {
      const message = errorValue instanceof Error ? errorValue.message : "name_update_failed";
      setNameError(
        message === "name_must_be_between_2_and_80_chars"
          ? "Name must be between 2 and 80 characters."
          : message === "not_allowed"
            ? "Only admins can change their own names."
            : "Could not save your name.",
      );
    } finally {
      setNamePending(false);
    }
  }

  async function onSaveSwitchPin() {
    if (pinPending) {
      return;
    }
    setPinPending(true);
    setPinError("");
    setPinSuccess("");
    try {
      const response = await fetch("/api/account-switch/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, confirmPin }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `PIN_SAVE_HTTP_${response.status}`);
      }
      setPin("");
      setConfirmPin("");
      setPinSuccess("PIN saved.");
    } catch (errorValue) {
      setPinError(errorValue instanceof Error ? errorValue.message : "pin_update_failed");
    } finally {
      setPinPending(false);
    }
  }

  return (
    <main className="panel family-page profile-page">
      <div className="page-header-row">
        <div className="page-header-inline">
          <BackLink className="page-back-link" fallbackHref="/" />
          <h1>Profile</h1>
        </div>
      </div>
      <p className="small family-page-subhead">Your account details and personalization settings.</p>

      {isSwitched ? (
        <p className="small profile-switch-banner">
          You are using this child profile through {authenticatedName || "the parent account"}. Logging out switches
          back to the parent.
        </p>
      ) : null}
      {error ? <Alert>Could not load profile settings: {error}</Alert> : null}

      <ProfileDetailsSection
        displayName={displayName}
        displayEmail={displayEmail}
        role={role}
        isLoading={isLoading}
        canEditName={role === "admin" && !isSwitched}
        isEditingName={isEditingName}
        editedName={editedName}
        namePending={namePending}
        nameError={nameError}
        picture={picture}
        activeAvatarId={activeAvatarId}
        activeAvatarPhotoUrl={activeAvatarPhotoUrl}
        themePalette={themePalette}
        activeThemeName={activeThemeName}
        isDefaultThemeActive={isDefaultThemeActive}
        activeConfettiName={activeConfettiName}
        isDefaultConfettiActive={isDefaultConfettiActive}
        activeConfettiColors={activeConfettiColors}
        onNameDraftChange={(value) => {
          setEditedName(value);
          setNameError("");
        }}
        onStartNameEdit={() => {
          setEditedName(displayName);
          setNameError("");
          setIsEditingName(true);
        }}
        onCancelNameEdit={() => {
          setEditedName(displayName);
          setNameError("");
          setIsEditingName(false);
        }}
        onSaveNameEdit={() => {
          void onSaveNameEdit();
        }}
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
      />

      {googleTasksLoading && !googleTasksSummary ? (
        <section className="profile-google-card-wrap">
          <article className="profile-page-google-card">
            <h2>Google Account</h2>
            <p className="small">Loading Google account status...</p>
          </article>
        </section>
      ) : !googleAccountLinked ? (
        <section className="profile-google-card-wrap">
          <article className="profile-page-google-card">
            <h2>Google Account</h2>
            {googleAccountRedirectError ? (
              <Alert>Could not link Google account: {googleAccountRedirectError}</Alert>
            ) : null}
            {googleAccountLinkedMessage ? <p className="small">{googleAccountLinkedMessage}</p> : null}
            <p className="small">
              This profile is not linked to Google yet. Link it later when you want this child to sign in with Google
              and unlock Google Tasks sync.
            </p>
            {googleClientId ? (
              <GoogleSignInButton mode="gsi" clientId={googleClientId} loginUri={googleAccountLinkUri} width={260} />
            ) : (
              <Alert>Google sign-in is not configured for linking.</Alert>
            )}
          </article>
        </section>
      ) : (
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
      )}

      {role === "admin" && !isSwitched ? (
        <section className="profile-google-card-wrap">
          <article className="profile-page-google-card">
            <h2>Switch PIN</h2>
            <p className="small">
              Set a 4-digit PIN for switching into a child account and returning to your parent profile.
            </p>
            {pinError ? <Alert>Could not save PIN: {pinError}</Alert> : null}
            {pinSuccess ? <p className="small">{pinSuccess}</p> : null}
            <div className="profile-switch-pin-grid">
              <label className="flex w-full flex-col gap-1.5">
                <span className="text-sm font-medium text-slate-700">PIN</span>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="\d{4}"
                  maxLength={4}
                  autoComplete="new-password"
                  value={pin}
                  onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
                  className="h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400"
                />
              </label>
              <label className="flex w-full flex-col gap-1.5">
                <span className="text-sm font-medium text-slate-700">Confirm PIN</span>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="\d{4}"
                  maxLength={4}
                  autoComplete="new-password"
                  value={confirmPin}
                  onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
                  className="h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400"
                />
              </label>
            </div>
            <div className="profile-google-actions">
              <Button type="button" className="btn btn-primary" disabled={pinPending} onClick={onSaveSwitchPin}>
                {pinPending ? "Saving..." : "Save PIN"}
              </Button>
            </div>
          </article>
        </section>
      ) : null}

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

