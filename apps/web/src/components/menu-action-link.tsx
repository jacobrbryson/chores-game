"use client";

import Link from "next/link";
import { ReactNode } from "react";

type MenuActionLinkProps = {
  href: string;
  children: ReactNode;
  leading?: ReactNode;
  className?: string;
  fullWidth?: boolean;
  onClick?: () => void;
  badgeCount?: number;
};

export function MenuActionLink({
  href,
  children,
  leading,
  className = "",
  fullWidth = false,
  onClick,
  badgeCount,
}: MenuActionLinkProps) {
  const showBadge = typeof badgeCount === "number" && badgeCount > 0;

  return (
    <Link
      href={href}
      onClick={onClick}
      className={`menu-action-link${fullWidth ? " menu-action-link-full" : ""}${
        className ? ` ${className}` : ""
      }`}>
      <span className="menu-action-link-label">
        {leading ? <span className="menu-action-link-icon">{leading}</span> : null}
        <span>{children}</span>
      </span>
      {showBadge ? <span className="menu-link-count">{badgeCount}</span> : null}
    </Link>
  );
}
