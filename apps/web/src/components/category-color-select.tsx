"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { getStoreColorName } from "@/lib/store/catalog";

type CategoryColorSelectProps = {
  ariaLabel: string;
  /** Palette of hex colors to choose from. */
  options: string[];
  /** Currently selected hex color. */
  value: string;
  onChange: (value: string) => void;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  disabled?: boolean;
};

function joinClasses(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(" ");
}

/**
 * A select-style control for picking a chip color. The trigger matches the app's
 * standard select chrome (`theme-select-trigger`); the menu renders the color
 * swatch grid instead of a list of text options.
 */
export function CategoryColorSelect({
  ariaLabel,
  options,
  value,
  onChange,
  className,
  buttonClassName,
  menuClassName,
  disabled = false,
}: CategoryColorSelectProps) {
  const MENU_GAP_PX = 6;
  const VIEWPORT_MARGIN_PX = 8;
  const MENU_MIN_HEIGHT_PX = 216;
  const MENU_MAX_HEIGHT_PX = 260;

  const menuId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  const updateMenuPosition = useCallback(() => {
    if (!buttonRef.current || typeof window === "undefined") {
      return;
    }
    const rect = buttonRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - rect.bottom - VIEWPORT_MARGIN_PX;
    const spaceAbove = rect.top - VIEWPORT_MARGIN_PX;
    const openUpward = spaceBelow < 180 && spaceAbove > spaceBelow;
    const availableHeight = Math.max(0, (openUpward ? spaceAbove : spaceBelow) - MENU_GAP_PX);
    const maxHeight = Math.max(
      MENU_MIN_HEIGHT_PX,
      Math.min(MENU_MAX_HEIGHT_PX, availableHeight),
    );
    const width = Math.min(rect.width, viewportWidth - VIEWPORT_MARGIN_PX * 2);
    let left = rect.left;
    if (left + width > viewportWidth - VIEWPORT_MARGIN_PX) {
      left = viewportWidth - VIEWPORT_MARGIN_PX - width;
    }
    left = Math.max(VIEWPORT_MARGIN_PX, left);
    const top = openUpward
      ? Math.max(VIEWPORT_MARGIN_PX, rect.top - maxHeight - MENU_GAP_PX)
      : Math.min(viewportHeight - VIEWPORT_MARGIN_PX, rect.bottom + MENU_GAP_PX);

    setMenuPosition({ top, left, width, maxHeight });
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) {
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

  useEffect(() => {
    if (!open) {
      return;
    }
    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  function onButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) {
      return;
    }
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !open) {
      event.preventDefault();
      setOpen(true);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  function selectColor(hex: string) {
    onChange(hex);
    setOpen(false);
    buttonRef.current?.focus();
  }

  const hasValue = Boolean(value);

  const menuNode =
    open && menuPosition ? (
      <div
        id={menuId}
        ref={menuRef}
        role="dialog"
        aria-label={ariaLabel}
        style={{
          position: "fixed",
          top: menuPosition.top,
          left: menuPosition.left,
          width: menuPosition.width,
          maxHeight: menuPosition.maxHeight,
        }}
        className={joinClasses(
          "theme-select-menu z-[160] overflow-auto rounded-lg border border-slate-200 bg-white p-2 shadow-lg",
          menuClassName,
        )}>
        <div className="family-category-color-grid">
          {options.map((hex) => {
            const selected = value === hex;
            const colorName = getStoreColorName(hex);
            return (
              <button
                key={hex}
                type="button"
                aria-label={colorName}
                aria-pressed={selected}
                className={`family-category-color-swatch${selected ? " is-selected" : ""}`}
                style={{ backgroundColor: hex }}
                onClick={() => selectColor(hex)}
              />
            );
          })}
        </div>
      </div>
    ) : null;

  return (
    <div ref={rootRef} className={joinClasses("relative", className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        className={joinClasses("theme-select-trigger", buttonClassName)}
        onKeyDown={onButtonKeyDown}
        onClick={() => setOpen((current) => !current)}>
        <span className="flex min-w-0 items-center gap-2">
          {hasValue ? (
            <span
              aria-hidden="true"
              className="h-5 w-5 shrink-0 rounded-md border border-black/10"
              style={{ backgroundColor: value }}
            />
          ) : null}
          <span className="truncate text-left">{hasValue ? getStoreColorName(value) : "Select a color"}</span>
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className={joinClasses(
            "h-4 w-4 shrink-0 transition-transform",
            open && "rotate-180",
          )}>
          <path
            d="M5 7.5L10 12.5L15 7.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {menuNode && typeof document !== "undefined" ? createPortal(menuNode, document.body) : null}
    </div>
  );
}
