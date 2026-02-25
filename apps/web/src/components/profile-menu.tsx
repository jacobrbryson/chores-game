"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/button";
import { MenuActionLink } from "@/components/menu-action-link";

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
  const rootRef = useRef<HTMLDivElement | null>(null);

  const profileAvatarUrl =
    selectedAvatarId.trim()
      ? `/avatars/default/${encodeURIComponent(selectedAvatarId.trim())}`
      : selectedAvatarPhotoUrl.trim() || picture || "";

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
      setSelectedAvatarId(typeof payload.avatarId === "string" ? payload.avatarId : "");
      setSelectedAvatarPhotoUrl(
        typeof payload.avatarPhotoUrl === "string" ? payload.avatarPhotoUrl : "",
      );
    } catch {
      // Ignore avatar refresh errors in menu UI.
    }
  }

  useEffect(() => {
    void loadUnseenCount();
    void loadProfileAvatar();
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
          {profileAvatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="profile-avatar"
              src={profileAvatarUrl}
              alt={name || "User profile"}
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="profile-avatar profile-fallback">{initial}</span>
          )}
          {unseenCount > 0 ? <span className="notification-badge">{unseenCount}</span> : null}
        </span>
      </Button>
      {open ? (
        <div className="profile-dropdown">
          <p className="profile-name">{name || "Signed In"}</p>
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
