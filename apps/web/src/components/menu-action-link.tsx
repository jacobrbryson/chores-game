"use client";

import Link from "next/link";
import { ReactNode } from "react";

type MenuActionLinkProps = {
  href: string;
  children: ReactNode;
  className?: string;
  fullWidth?: boolean;
  onClick?: () => void;
};

export function MenuActionLink({
  href,
  children,
  className = "",
  fullWidth = false,
  onClick,
}: MenuActionLinkProps) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`menu-action-link${fullWidth ? " menu-action-link-full" : ""}${
        className ? ` ${className}` : ""
      }`}>
      {children}
    </Link>
  );
}

