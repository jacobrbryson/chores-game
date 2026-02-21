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
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
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
        {picture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="profile-avatar"
            src={picture}
            alt={name || "User profile"}
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="profile-avatar profile-fallback">{initial}</span>
        )}
      </Button>
      {open ? (
        <div className="profile-dropdown">
          <p className="profile-name">{name || "Signed In"}</p>
          <p className="profile-email">{email}</p>
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
