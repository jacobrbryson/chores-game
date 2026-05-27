"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { AccountSwitchModal } from "@/components/account-switch-modal";
import { Alert } from "@/components/alert";
import { AppMenu } from "@/components/app-menu";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/button";
import { CoinIcon } from "@/components/coin-icon";
import { GoogleTaskSyncIndicator } from "@/components/google-task-sync-indicator";
import { MenuActionButton } from "@/components/menu-action-button";
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
  showSupportLink?: boolean;
  triggerVariant?: "avatar" | "main-nav";
  triggerLabel?: string;
};

type SwitchableMember = FamilySummaryResponse["members"][number];

function ProfileMenuItemIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true">
      {children}
    </svg>
  );
}

const notificationsIcon = (
  <ProfileMenuItemIcon>
    <path d="M10 3.5a4 4 0 0 0-4 4v1.6c0 .7-.2 1.3-.58 1.88L4.4 12.5h11.2l-1.02-1.52A3.4 3.4 0 0 1 14 9.1V7.5a4 4 0 0 0-4-4Z" />
    <path d="M8.25 14.5a1.75 1.75 0 0 0 3.5 0" />
  </ProfileMenuItemIcon>
);

const profileIcon = (
  <ProfileMenuItemIcon>
    <circle cx="10" cy="6.5" r="2.5" />
    <path d="M5.5 15.25a4.5 4.5 0 0 1 9 0" />
  </ProfileMenuItemIcon>
);

const familyIcon = (
  <ProfileMenuItemIcon>
    <circle cx="7" cy="7" r="2" />
    <circle cx="13.5" cy="8" r="1.75" />
    <path d="M3.75 15a3.5 3.5 0 0 1 6.5 0" />
    <path d="M11 14.75a3 3 0 0 1 5.25-.75" />
  </ProfileMenuItemIcon>
);

const supportIcon = (
  <ProfileMenuItemIcon>
    <path d="M5.25 10.25v-.5a4.75 4.75 0 0 1 9.5 0v.5" />
    <path d="M5.25 10.25a1.5 1.5 0 0 0-1.5 1.5v1a1.5 1.5 0 0 0 1.5 1.5h1.25v-4H5.25Z" />
    <path d="M14.75 10.25a1.5 1.5 0 0 1 1.5 1.5v1a1.5 1.5 0 0 1-1.5 1.5H13.5v-4h1.25Z" />
    <path d="M8 15.75h2.75a1.5 1.5 0 0 0 1.5-1.5" />
  </ProfileMenuItemIcon>
);

const switchIcon = (
  <ProfileMenuItemIcon>
    <path d="M7 6.25h8.25" />
    <path d="m12.75 3.75 2.5 2.5-2.5 2.5" />
    <path d="M13 13.75H4.75" />
    <path d="m7.25 11.25-2.5 2.5 2.5 2.5" />
  </ProfileMenuItemIcon>
);

const returnParentIcon = (
  <ProfileMenuItemIcon>
    <path d="M8 5.25 4.75 8.5 8 11.75" />
    <path d="M5 8.5h5a4 4 0 1 1 0 8H7.75" />
  </ProfileMenuItemIcon>
);

const logoutIcon = (
  <ProfileMenuItemIcon>
    <path d="M8 4.5H5.75A1.75 1.75 0 0 0 4 6.25v7.5c0 .97.78 1.75 1.75 1.75H8" />
    <path d="M10.25 10h5.25" />
    <path d="m13 7.25 2.75 2.75L13 12.75" />
  </ProfileMenuItemIcon>
);

function formatCompactBalance(value: number) {
  if (value < 1000) {
    return `${value}`;
  }
  if (value < 1_000_000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  if (value < 1_000_000_000) {
    return `${(value / 1_000_000).toFixed(1)}m`;
  }
  return `${(value / 1_000_000_000).toFixed(1)}b`;
}

export function ProfileMenu({
  name,
  email,
  picture,
  initial,
  isSwitched = false,
  authenticatedName = "",
  showSupportLink = false,
  triggerVariant = "avatar",
  triggerLabel = "More",
}: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState(name);
  const [unseenCount, setUnseenCount] = useState(0);
  const [selectedAvatarId, setSelectedAvatarId] = useState("");
  const [selectedAvatarPhotoUrl, setSelectedAvatarPhotoUrl] = useState("");
  const [headerCoinBalance, setHeaderCoinBalance] = useState(0);
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
  const notificationsHref = unseenCount > 0 ? "/notifications?unseen=true" : "/notifications";

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

  async function loadHeaderCoinBalance() {
    try {
      const response = await fetch("/api/store?brief=1", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as { balance?: number };
      setHeaderCoinBalance(
        typeof payload.balance === "number" ? Math.max(0, payload.balance) : 0,
      );
    } catch {
      // Ignore coin refresh errors in menu UI.
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
    setDisplayName(name);
  }, [name]);

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
    void loadHeaderCoinBalance();
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
    function onWalletRefresh() {
      void loadHeaderCoinBalance();
    }
    window.addEventListener("wallet:refresh", onWalletRefresh);
    return () => {
      window.removeEventListener("wallet:refresh", onWalletRefresh);
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
    function onProfileNameRefresh(event: Event) {
      const detail =
        event instanceof CustomEvent && typeof event.detail?.name === "string" ? event.detail.name : "";
      if (detail.trim()) {
        setDisplayName(detail.trim());
      }
    }
    window.addEventListener("profile-name:refresh", onProfileNameRefresh);
    return () => {
      window.removeEventListener("profile-name:refresh", onProfileNameRefresh);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    void loadUnseenCount();
    void loadHeaderCoinBalance();
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
        triggerClassName={triggerVariant === "main-nav" ? "main-nav-button main-nav-more-button" : ""}
        triggerTitle="Open profile menu"
        triggerAriaLabel="Open profile menu"
        panelClassName="app-menu-panel profile-dropdown"
        trigger={
          <span className={`profile-avatar-wrap${triggerVariant === "main-nav" ? " profile-avatar-wrap-main-nav" : ""}`}>
            <span className="profile-avatar-anchor">
              <Avatar
                className="profile-avatar"
                name={displayName || "User profile"}
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
            <span className="profile-avatar-store-chip" aria-hidden="true">
              <CoinIcon size={11} />
              <span className="profile-avatar-store-balance">
                {formatCompactBalance(headerCoinBalance)}
              </span>
            </span>
          </span>
        }>
        <div className="profile-name-row">
          <p className="profile-name">{displayName || "Signed In"}</p>
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
          href={notificationsHref}
          fullWidth
          onClick={() => setOpen(false)}
          leading={notificationsIcon}
          badgeCount={unseenCount}>
          Notifications
        </MenuActionLink>
        <MenuActionLink href="/profile" fullWidth onClick={() => setOpen(false)} leading={profileIcon}>
          Profile
        </MenuActionLink>
        <MenuActionLink href="/family" fullWidth onClick={() => setOpen(false)} leading={familyIcon}>
          Manage Family
        </MenuActionLink>
        {showSupportLink ? (
          <MenuActionLink href="/support" fullWidth onClick={() => setOpen(false)} leading={supportIcon}>
            Support
          </MenuActionLink>
        ) : null}
        {!isSwitched ? (
          <MenuActionButton
            fullWidth
            leading={switchIcon}
            onClick={() => {
              setOpen(false);
              openSwitchPicker();
            }}>
            Switch To...
          </MenuActionButton>
        ) : null}
        {isSwitched ? (
          <MenuActionButton
            fullWidth
            leading={returnParentIcon}
            onClick={() => {
              setOpen(false);
              setRestorePin("");
              setRestoreError("");
              setRestoreModalOpen(true);
            }}>
            Return to Parent
          </MenuActionButton>
        ) : null}
        <div className="profile-divider" />
        <form action="/api/auth/logout" method="post">
          <MenuActionButton fullWidth type="submit" leading={logoutIcon}>
            Logout
          </MenuActionButton>
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
                autoFocus
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
