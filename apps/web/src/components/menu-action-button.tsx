"use client";

import { Button } from "@/components/button";
import { ReactNode } from "react";

type MenuActionButtonProps = {
  children: ReactNode;
  leading?: ReactNode;
  className?: string;
  fullWidth?: boolean;
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  trailing?: ReactNode;
  trailingClassName?: string;
  disabled?: boolean;
  /**
   * Tooltip text. When the button is disabled this is required for any action
   * the user might reasonably expect to work — it must explain *why* it is
   * disabled. Browsers suppress native `title` tooltips on disabled controls,
   * so a disabled button with a title is wrapped in a hoverable span.
   */
  title?: string;
};

export function MenuActionButton({
  children,
  leading,
  className = "",
  fullWidth = false,
  onClick,
  type = "button",
  trailing,
  trailingClassName = "",
  disabled = false,
  title,
}: MenuActionButtonProps) {
  const button = (
    <Button
      type={type}
      className={`menu-action-link${fullWidth ? " menu-action-link-full" : ""}${
        className ? ` ${className}` : ""
      }`}
      onClick={onClick}
      disabled={disabled}
      title={disabled ? undefined : title}>
      <span className="menu-action-link-label">
        {leading ? <span className="menu-action-link-icon">{leading}</span> : null}
        <span>{children}</span>
      </span>
      {trailing ? <span className={trailingClassName}>{trailing}</span> : null}
    </Button>
  );
  if (disabled && title) {
    return (
      <span
        className={`menu-action-tooltip-wrap${fullWidth ? " menu-action-tooltip-wrap-full" : ""}`}
        title={title}>
        {button}
      </span>
    );
  }
  return button;
}
