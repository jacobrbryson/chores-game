"use client";

import { Button } from "@/components/button";
import { ReactNode } from "react";

type MenuActionButtonProps = {
  children: ReactNode;
  className?: string;
  fullWidth?: boolean;
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  trailing?: ReactNode;
  trailingClassName?: string;
  disabled?: boolean;
};

export function MenuActionButton({
  children,
  className = "",
  fullWidth = false,
  onClick,
  type = "button",
  trailing,
  trailingClassName = "",
  disabled = false,
}: MenuActionButtonProps) {
  return (
    <Button
      type={type}
      className={`menu-action-link${fullWidth ? " menu-action-link-full" : ""}${
        className ? ` ${className}` : ""
      }`}
      onClick={onClick}
      disabled={disabled}>
      <span className="menu-action-link-label">{children}</span>
      {trailing ? <span className={trailingClassName}>{trailing}</span> : null}
    </Button>
  );
}
