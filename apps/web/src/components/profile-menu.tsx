"use client";

import { useEffect, useRef, useState } from "react";
import { AccountSwitchModal } from "@/components/account-switch-modal";
import { Alert } from "@/components/alert";
import { AppMenu } from "@/components/app-menu";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/button";
import { GoogleTaskSyncIndicator } from "@/components/google-task-sync-indicator";
import { MenuActionLink } from "@/components/menu-action-link";
import { ModalShell } from "@/components/modal-shell";
import type { FamilySummaryResponse } from "@/lib/family/types";

const PROFILE_AVATAR_STORAGE_KEY_PREFIX = "profile_avatar_cache_v1";

type StoredProfileAvatar = {
  avatarId: string;
  avatarPhotoUrl: string;
  themePrimaryColor: string;
  themeSecondaryColor: string;
};

function getProfileAvatarStorageKey(email: string) {
  return `${PROFILE_AVATAR_STORAGE_KEY_PREFIX}:${encodeURIComponent(email.trim().toLowerCase())}`;
}

function readProfileAvatarFromStorage(email: string): StoredProfileAvatar | null {
  if (typeof window === "undefined") {
    return null;
  }
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(getProfileAvatarStorageKey(normalizedEmail));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as {
      avatarId?: unknown;
      avatarPhotoUrl?: unknown;
      themePrimaryColor?: unknown;
      themeSecondaryColor?: unknown;
    };
    return {
      avatarId: typeof parsed.avatarId === "string" ? parsed.avatarId : "",
      avatarPhotoUrl: typeof parsed.avatarPhotoUrl === "string" ? parsed.avatarPhotoUrl : "",
      themePrimaryColor: typeof parsed.themePrimaryColor === "string" ? parsed.themePrimaryColor : "",
      themeSecondaryColor:
        typeof parsed.themeSecondaryColor === "string" ? parsed.themeSecondaryColor : "",
    };
  } catch {
    return null;
  }
}

function writeProfileAvatarToStorage(email: string, avatar: StoredProfileAvatar) {
  if (typeof window === "undefined") {
    return;
  }
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return;
  }
  try {
    const storageKey = getProfileAvatarStorageKey(normalizedEmail);
    if (!avatar.avatarId && !avatar.avatarPhotoUrl) {
      window.localStorage.removeItem(storageKey);
      return;
    }
    window.localStorage.setItem(storageKey, JSON.stringify(avatar));
  } catch {
    // Ignore localStorage write errors in menu UI.
  }
}

type ProfileMenuProps = {
  name: string;
  email: string;
  picture?: string;
  initial: string;
  isSwitched?: boolean;
  authenticatedName?: string;
};

type SwitchableMember = FamilySummaryResponse["members"][number];

export function ProfileMenu({
  name,
  email,
  picture,
  initial,
  isSwitched = false,
  authenticatedName = "",
}: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const [unseenCount, setUnseenCount] = useState(0);
  const [selectedAvatarId, setSelectedAvatarId] = useState("");
  const [selectedAvatarPhotoUrl, setSelectedAvatarPhotoUrl] = useState("");
  const [themePrimaryColor, setThemePrimaryColor] = useState("");
  const [themeSecondaryColor, setThemeSecondaryColor] = useState("");
  const [googleTasksLinked, setGoogleTasksLinked] = useState(false);
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [restorePin, setRestorePin] = useState("");
  const [restorePending, setRestorePending] = useState(false);
  const [restoreError, setRestoreError] = useState("");
  const [switchPickerOpen, setSwitchPickerOpen] = useState(false);
  const [switchableMembers, setSwitchableMembers] = useState<SwitchableMember[]>([]);
  const [switchMembersLoading, setSwitchMembersLoading] = useState(false);
  const [switchMembersError, setSwitchMembersError] = useState("");
  const [pendingSwitchMember, setPendingSwitchMember] = useState<SwitchableMember | null>(null);
  const [switchPin, setSwitchPin] = useState("");
  const [switchPinConfirm, setSwitchPinConfirm] = useState("");
  const [switchPending, setSwitchPending] = useState(false);
  const [switchError, setSwitchError] = useState("");
  const [switchRequiresPinSetup, setSwitchRequiresPinSetup] = useState(false);
  const storageEmailRef = useRef(email);

  async function loadUnseenCount() {
    try {
      const response = await fetch("/api/notifications?summary=count", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as { unseenCount?: number };
      setUnseenCount(
        typeof payload.unseenCount === "number" ? Math.max(0, payload.unseenCount) : 0,
      );
    } catch {
      // Ignore count refresh errors in menu UI.
    }
  }

  async function loadProfileAvatar() {
    try {
      const response = await fetch("/api/store", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as {
        avatarId?: string;
        avatarPhotoUrl?: string;
        themePrimaryColor?: string;
        themeSecondaryColor?: string;
      };
      const avatar = {
        avatarId: typeof payload.avatarId === "string" ? payload.avatarId : "",
        avatarPhotoUrl: typeof payload.avatarPhotoUrl === "string" ? payload.avatarPhotoUrl : "",
        themePrimaryColor:
          typeof payload.themePrimaryColor === "string" ? payload.themePrimaryColor : "",
        themeSecondaryColor:
          typeof payload.themeSecondaryColor === "string" ? payload.themeSecondaryColor : "",
      };
      setSelectedAvatarId(avatar.avatarId);
      setSelectedAvatarPhotoUrl(avatar.avatarPhotoUrl);
      setThemePrimaryColor(avatar.themePrimaryColor);
      setThemeSecondaryColor(avatar.themeSecondaryColor || avatar.themePrimaryColor);
      writeProfileAvatarToStorage(storageEmailRef.current, avatar);
    } catch {
      // Ignore avatar refresh errors in menu UI.
    }
  }

  async function loadGoogleTasksLinkState() {
    try {
      const response = await fetch("/api/google-tasks", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as { linked?: boolean };
      setGoogleTasksLinked(payload.linked === true);
    } catch {
      // Ignore Google Tasks link-status refresh errors in menu UI.
    }
  }

  async function loadSwitchableMembers() {
    setSwitchMembersLoading(true);
    setSwitchMembersError("");
    try {
      const tzOffsetMinutes = new Date().getTimezoneOffset();
      const response = await fetch(`/api/family/summary?tzOffsetMinutes=${tzOffsetMinutes}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `FAMILY_SUMMARY_HTTP_${response.status}`);
      }
      const payload = (await response.json()) as FamilySummaryResponse;
      const nextMembers = (Array.isArray(payload.members) ? payload.members : []).filter(
        (member) =>
          member.role === "player" &&
          member.id !== payload.viewerUid &&
          member.uid !== payload.viewerUid,
      );
      setSwitchableMembers(nextMembers);
    } catch (errorValue) {
      setSwitchableMembers([]);
      setSwitchMembersError(
        errorValue instanceof Error ? errorValue.message : "switchable_members_unavailable",
      );
    } finally {
      setSwitchMembersLoading(false);
    }
  }

  useEffect(() => {
    storageEmailRef.current = email;
    const storedAvatar = readProfileAvatarFromStorage(storageEmailRef.current);
    if (storedAvatar) {
      setSelectedAvatarId(storedAvatar.avatarId);
      setSelectedAvatarPhotoUrl(storedAvatar.avatarPhotoUrl);
      setThemePrimaryColor(storedAvatar.themePrimaryColor);
      setThemeSecondaryColor(storedAvatar.themeSecondaryColor || storedAvatar.themePrimaryColor);
    }
    void loadUnseenCount();
    void loadProfileAvatar();
    void loadGoogleTasksLinkState();
  }, []);

  useEffect(() => {
    function onNotificationsRefresh() {
      void loadUnseenCount();
    }
    window.addEventListener("notifications:refresh", onNotificationsRefresh);
    return () => {
      window.removeEventListener("notifications:refresh", onNotificationsRefresh);
    };
  }, []);

  useEffect(() => {
    function onProfileAvatarRefresh() {
      void loadProfileAvatar();
    }
    window.addEventListener("profile-avatar:refresh", onProfileAvatarRefresh);
    return () => {
      window.removeEventListener("profile-avatar:refresh", onProfileAvatarRefresh);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    void loadUnseenCount();
    void loadGoogleTasksLinkState();
  }, [open]);

  async function onRestoreParent() {
    if (restorePending) {
      return;
    }
    setRestorePending(true);
    setRestoreError("");
    try {
      const response = await fetch("/api/account-switch/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: restorePin }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `RESTORE_PARENT_HTTP_${response.status}`);
      }
      if (typeof window !== "undefined") {
        window.location.reload();
      }
    } catch (errorValue) {
      setRestoreError(errorValue instanceof Error ? errorValue.message : "restore_account_failed");
    } finally {
      setRestorePending(false);
    }
  }

  async function onSwitchAccount() {
    if (!pendingSwitchMember || switchPending) {
      return;
    }
    setSwitchPending(true);
    setSwitchError("");
    try {
      const response = await fetch("/api/account-switch/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: pendingSwitchMember.id,
          pin: switchPin,
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        if (body.error === "pin_not_configured") {
          setSwitchRequiresPinSetup(true);
          throw new Error("pin_not_configured");
        }
        throw new Error(body.error ?? `SWITCH_ACCOUNT_HTTP_${response.status}`);
      }
      if (typeof window !== "undefined") {
        window.location.assign("/");
      }
    } catch (errorValue) {
      setSwitchError(errorValue instanceof Error ? errorValue.message : "switch_account_failed");
    } finally {
      setSwitchPending(false);
    }
  }

  async function onSetupPinAndSwitch() {
    if (!pendingSwitchMember || switchPending) {
      return;
    }
    setSwitchPending(true);
    setSwitchError("");
    try {
      const pinResponse = await fetch("/api/account-switch/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pin: switchPin,
          confirmPin: switchPinConfirm,
        }),
      });
      if (!pinResponse.ok) {
        const body = (await pinResponse.json()) as { error?: string };
        throw new Error(body.error ?? `PIN_SETUP_HTTP_${pinResponse.status}`);
      }

      const switchResponse = await fetch("/api/account-switch/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: pendingSwitchMember.id,
          pin: switchPin,
        }),
      });
      if (!switchResponse.ok) {
        const body = (await switchResponse.json()) as { error?: string };
        throw new Error(body.error ?? `SWITCH_ACCOUNT_HTTP_${switchResponse.status}`);
      }

      if (typeof window !== "undefined") {
        window.location.assign("/");
      }
    } catch (errorValue) {
      setSwitchError(errorValue instanceof Error ? errorValue.message : "switch_account_failed");
    } finally {
      setSwitchPending(false);
    }
  }

  function openSwitchPicker() {
    setSwitchPickerOpen(true);
    void loadSwitchableMembers();
  }

  function closeSwitchPicker() {
    setSwitchPickerOpen(false);
    setSwitchMembersError("");
  }

  function openSwitchMemberModal(member: SwitchableMember) {
    setPendingSwitchMember(member);
    setSwitchPin("");
    setSwitchPinConfirm("");
    setSwitchError("");
    setSwitchRequiresPinSetup(false);
  }

  function closeSwitchMemberModal() {
    setPendingSwitchMember(null);
    setSwitchPin("");
    setSwitchPinConfirm("");
    setSwitchError("");
    setSwitchRequiresPinSetup(false);
  }

  return (
    <>
      <AppMenu
        open={open}
        onOpenChange={setOpen}
        wrapperClassName="profile-menu"
        triggerClassName="profile-menu-trigger"
        triggerTitle="Open profile menu"
        triggerAriaLabel="Open profile menu"
        panelClassName="app-menu-panel profile-dropdown"
        trigger={
          <span className="profile-avatar-wrap">
            <Avatar
              className="profile-avatar"
              name={name || "User profile"}
              initial={initial}
              avatarId={selectedAvatarId}
              photoUrl={selectedAvatarPhotoUrl || picture || ""}
              primaryColor={themePrimaryColor || undefined}
              secondaryColor={(themeSecondaryColor || themePrimaryColor) || undefined}
              fallbackColor={themePrimaryColor ? "#ffffff" : undefined}
              referrerPolicy="no-referrer"
              loading="eager"
              decoding="async"
            />
            {unseenCount > 0 ? <span className="notification-badge">{unseenCount}</span> : null}
          </span>
        }>
        <div className="profile-name-row">
          <p className="profile-name">{name || "Signed In"}</p>
          {googleTasksLinked ? (
            <GoogleTaskSyncIndicator className="profile-menu-sync-indicator" label="Synced" />
          ) : null}
        </div>
        <p className="profile-email">{email || "-"}</p>
        {isSwitched ? (
          <p className="small profile-menu-switch-note">
            Acting as this child profile. Logging out returns to {authenticatedName || "the parent account"}.
          </p>
        ) : null}
        <MenuActionLink
          href="/notifications?unseen=true"
          fullWidth
          onClick={() => setOpen(false)}
          badgeCount={unseenCount}>
          Notifications
        </MenuActionLink>
        <MenuActionLink href="/profile" fullWidth onClick={() => setOpen(false)}>
          Profile
        </MenuActionLink>
        <MenuActionLink href="/family" fullWidth onClick={() => setOpen(false)}>
          Manage Family
        </MenuActionLink>
        {!isSwitched ? (
          <Button
            type="button"
            className="menu-action-link menu-action-link-full"
            onClick={() => {
              setOpen(false);
              openSwitchPicker();
            }}>
            Switch To...
          </Button>
        ) : null}
        {isSwitched ? (
          <Button
            type="button"
            className="menu-action-link menu-action-link-full"
            onClick={() => {
              setOpen(false);
              setRestorePin("");
              setRestoreError("");
              setRestoreModalOpen(true);
            }}>
            Return to Parent
          </Button>
        ) : null}
        <div className="profile-divider" />
        <form action="/api/auth/logout" method="post">
          <Button type="submit" className="menu-action-link menu-action-link-full">
            Logout
          </Button>
        </form>
      </AppMenu>
      <ModalShell open={switchPickerOpen} onRequestClose={closeSwitchPicker}>
        <div className="family-modal-card">
          <div className="modal-dialog-title-row family-modal-title-row">
            <h3 className="family-modal-title">Switch to Child</h3>
            <Button
              type="button"
              className="modal-close-button"
              onClick={closeSwitchPicker}
              aria-label="Close dialog"
              title="Close dialog">
              X
            </Button>
          </div>
          <div className="flex w-full flex-col gap-3">
            <p className="small">
              Choose a child profile to act as. You stay authenticated as the parent account, and logging out always
              resets the session back to the parent.
            </p>
            {switchMembersError ? <Alert>Could not load switchable profiles: {switchMembersError}</Alert> : null}
            {switchMembersLoading ? <p className="small">Loading child profiles...</p> : null}
            {!switchMembersLoading && !switchMembersError ? (
              switchableMembers.length > 0 ? (
                <div className="switch-member-list">
                  {switchableMembers.map((member) => (
                    <Button
                      key={member.id}
                      type="button"
                      className="switch-member-option"
                      onClick={() => {
                        closeSwitchPicker();
                        openSwitchMemberModal(member);
                      }}>
                      <span className="switch-member-option-main">
                        <Avatar
                          className="completion-chart-avatar"
                          size={32}
                          borderWidth={1}
                          name={member.name}
                          avatarId={member.avatarId}
                          photoUrl={member.avatarPhotoUrl}
                          primaryColor={member.dashboardPrimaryColor}
                          secondaryColor={member.dashboardPrimaryColor}
                          fallbackColor={member.dashboardPrimaryColor ? "#ffffff" : undefined}
                          referrerPolicy="no-referrer"
                        />
                        <span className="switch-member-option-copy">
                          <span className="switch-member-option-name">{member.name}</span>
                          <span className="switch-member-option-meta">
                            {member.status === "active" ? "Ready to switch" : "Invite pending"}
                          </span>
                        </span>
                      </span>
                    </Button>
                  ))}
                </div>
              ) : (
                <p className="small">No child profiles are available to switch into.</p>
              )
            ) : null}
            <div className="family-modal-actions">
              <Button type="button" className="btn btn-secondary" onClick={closeSwitchPicker}>
                Close
              </Button>
            </div>
          </div>
        </div>
      </ModalShell>
      <AccountSwitchModal
        open={Boolean(pendingSwitchMember)}
        onRequestClose={closeSwitchMemberModal}
        memberName={pendingSwitchMember?.name ?? ""}
        pin={switchPin}
        onPinChange={setSwitchPin}
        confirmPin={switchPinConfirm}
        onConfirmPinChange={setSwitchPinConfirm}
        pending={switchPending}
        error={switchError}
        requiresPinSetup={switchRequiresPinSetup}
        onConfirm={switchRequiresPinSetup ? onSetupPinAndSwitch : onSwitchAccount}
      />
      <ModalShell open={restoreModalOpen} onRequestClose={() => setRestoreModalOpen(false)}>
        <form
          className="family-modal-card"
          onSubmit={(event) => {
            event.preventDefault();
            if (!restorePending) {
              void onRestoreParent();
            }
          }}>
          <div className="modal-dialog-title-row family-modal-title-row">
            <h3 className="family-modal-title">Return to Parent</h3>
            <Button
              type="button"
              className="modal-close-button"
              onClick={() => setRestoreModalOpen(false)}
              aria-label="Close dialog"
              title="Close dialog">
              X
            </Button>
          </div>
          <div className="flex w-full flex-col gap-3">
            <p className="small">
              Enter the 4-digit parent PIN to return to {authenticatedName || "the parent account"}.
            </p>
            {restoreError ? <Alert>Could not switch back: {restoreError}</Alert> : null}
            <label className="flex w-full flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700">PIN</span>
              <input
                type="password"
                name="guardian-return-code"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                autoComplete="new-password"
                autoCorrect="off"
                spellCheck={false}
                data-1p-ignore="true"
                data-lpignore="true"
                value={restorePin}
                onChange={(event) => setRestorePin(event.target.value.replace(/\D/g, "").slice(0, 4))}
                className="h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400"
              />
            </label>
            <div className="family-modal-actions">
              <Button type="button" className="btn btn-secondary" onClick={() => setRestoreModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" className="btn btn-primary" disabled={restorePending}>
                {restorePending ? "Checking..." : "Return to Parent"}
              </Button>
            </div>
          </div>
        </form>
      </ModalShell>
    </>
  );
}
