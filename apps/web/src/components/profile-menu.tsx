"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/button";
import { GoogleTaskSyncIndicator } from "@/components/google-task-sync-indicator";
import { MenuActionLink } from "@/components/menu-action-link";

const PROFILE_AVATAR_STORAGE_KEY_PREFIX = "profile_avatar_cache_v1";

type StoredProfileAvatar = {
  avatarId: string;
  avatarPhotoUrl: string;
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
    const parsed = JSON.parse(raw) as { avatarId?: unknown; avatarPhotoUrl?: unknown };
    return {
      avatarId: typeof parsed.avatarId === "string" ? parsed.avatarId : "",
      avatarPhotoUrl: typeof parsed.avatarPhotoUrl === "string" ? parsed.avatarPhotoUrl : "",
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
};

export function ProfileMenu({ name, email, picture, initial }: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const [unseenCount, setUnseenCount] = useState(0);
  const [selectedAvatarId, setSelectedAvatarId] = useState("");
  const [selectedAvatarPhotoUrl, setSelectedAvatarPhotoUrl] = useState("");
  const [googleTasksLinked, setGoogleTasksLinked] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
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
      const payload = (await response.json()) as { avatarId?: string; avatarPhotoUrl?: string };
      const avatar = {
        avatarId: typeof payload.avatarId === "string" ? payload.avatarId : "",
        avatarPhotoUrl: typeof payload.avatarPhotoUrl === "string" ? payload.avatarPhotoUrl : "",
      };
      setSelectedAvatarId(avatar.avatarId);
      setSelectedAvatarPhotoUrl(avatar.avatarPhotoUrl);
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

  useEffect(() => {
    storageEmailRef.current = email;
    const storedAvatar = readProfileAvatarFromStorage(storageEmailRef.current);
    if (storedAvatar) {
      setSelectedAvatarId(storedAvatar.avatarId);
      setSelectedAvatarPhotoUrl(storedAvatar.avatarPhotoUrl);
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
    function onPointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (rootRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  return (
    <div className="profile-menu" ref={rootRef}>
      <Button type="button" className="profile-menu-trigger" onClick={() => setOpen((v) => !v)}>
        <span className="profile-avatar-wrap">
          <Avatar
            className="profile-avatar"
            name={name || "User profile"}
            initial={initial}
            avatarId={selectedAvatarId}
            photoUrl={selectedAvatarPhotoUrl || picture || ""}
            referrerPolicy="no-referrer"
            loading="eager"
            decoding="async"
          />
          {unseenCount > 0 ? <span className="notification-badge">{unseenCount}</span> : null}
        </span>
      </Button>
      {open ? (
        <div className="profile-dropdown">
          <div className="profile-name-row">
            <p className="profile-name">{name || "Signed In"}</p>
            {googleTasksLinked ? (
              <GoogleTaskSyncIndicator className="profile-menu-sync-indicator" label="Synced" />
            ) : null}
          </div>
          <p className="profile-email">{email}</p>
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
          <div className="profile-divider" />
          <form action="/api/auth/logout" method="post">
            <Button type="submit" className="menu-action-link menu-action-link-full">
              Logout
            </Button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
