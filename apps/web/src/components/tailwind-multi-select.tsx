"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { TailwindSelectOption } from "@/components/tailwind-select";

type TailwindMultiSelectProps<T extends string = string> = {
  ariaLabel: string;
  options: TailwindSelectOption<T>[];
  values: T[];
  onChange: (values: T[]) => void;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  disabled?: boolean;
  placeholder?: string;
  emptyState?: ReactNode;
};

function joinClasses(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(" ");
}

function uniqueValues<T extends string>(values: T[]) {
  return Array.from(new Set(values));
}

export function TailwindMultiSelect<T extends string = string>({
  ariaLabel,
  options,
  values,
  onChange,
  className,
  buttonClassName,
  menuClassName,
  disabled = false,
  placeholder = "Select options",
  emptyState,
}: TailwindMultiSelectProps<T>) {
  const MENU_GAP_PX = 6;
  const VIEWPORT_MARGIN_PX = 8;
  const MENU_MIN_HEIGHT_PX = 120;
  const MENU_MAX_HEIGHT_PX = 260;

  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLUListElement | null>(null);
  const selectedSet = useMemo(() => new Set(values), [values]);
  const selectedOptions = useMemo(
    () => options.filter((option) => selectedSet.has(option.value)),
    [options, selectedSet],
  );
  const firstEnabledIndex = useMemo(
    () => options.findIndex((option) => !option.disabled),
    [options],
  );
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(firstEnabledIndex);
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
    const openUpward = spaceBelow < 200 && spaceAbove > spaceBelow;
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
    setHighlightedIndex(firstEnabledIndex);
  }, [firstEnabledIndex, open]);

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

  const selectedLabel = useMemo(() => {
    if (selectedOptions.length === 0) {
      return placeholder;
    }
    if (selectedOptions.length === 1) {
      return selectedOptions[0]?.label ?? placeholder;
    }
    return `${selectedOptions.length} selected`;
  }, [placeholder, selectedOptions]);

  function findNextEnabledIndex(start: number, direction: 1 | -1) {
    if (options.length === 0) {
      return -1;
    }
    let index = start;
    for (let step = 0; step < options.length; step += 1) {
      index = (index + direction + options.length) % options.length;
      if (!options[index]?.disabled) {
        return index;
      }
    }
    return -1;
  }

  function toggleIndex(index: number) {
    if (index < 0 || !options[index] || options[index]?.disabled) {
      return;
    }
    const value = options[index].value;
    const nextValues = selectedSet.has(value)
      ? values.filter((entry) => entry !== value)
      : [...values, value];
    onChange(uniqueValues(nextValues));
  }

  function onButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setHighlightedIndex(firstEnabledIndex);
        return;
      }
      const next = findNextEnabledIndex(highlightedIndex, 1);
      if (next >= 0) {
        setHighlightedIndex(next);
      }
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setHighlightedIndex(firstEnabledIndex);
        return;
      }
      const previous = findNextEnabledIndex(highlightedIndex, -1);
      if (previous >= 0) {
        setHighlightedIndex(previous);
      }
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && open) {
      event.preventDefault();
      toggleIndex(highlightedIndex);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  const menuNode =
    open && menuPosition ? (
      <ul
        id={listboxId}
        ref={menuRef}
        role="listbox"
        aria-label={ariaLabel}
        aria-multiselectable="true"
        style={{
          position: "fixed",
          top: menuPosition.top,
          left: menuPosition.left,
          width: menuPosition.width,
          maxHeight: menuPosition.maxHeight,
        }}
        className={joinClasses(
          "theme-select-menu z-[70] overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg",
          menuClassName,
        )}>
        {options.length === 0 ? (
          <li role="presentation" className="px-2 py-2 text-sm text-slate-600">
            {emptyState ?? "No options available."}
          </li>
        ) : (
          options.map((option, index) => {
            const active = index === highlightedIndex;
            const selected = selectedSet.has(option.value);
            return (
              <li key={option.value} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={option.disabled}
                  className={joinClasses(
                    "theme-select-option flex items-center justify-between gap-2",
                    active && !option.disabled && "theme-select-option-active",
                    selected && !option.disabled && "theme-select-option-selected",
                    option.disabled && "cursor-not-allowed opacity-60",
                  )}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => toggleIndex(index)}>
                  <span>{option.label}</span>
                  <span aria-hidden="true">{selected ? "\u2713" : ""}</span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    ) : null;

  return (
    <div ref={rootRef} className={joinClasses("relative", className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        disabled={disabled}
        className={joinClasses("theme-select-trigger", buttonClassName)}
        onKeyDown={onButtonKeyDown}
        onClick={() => setOpen((current) => !current)}>
        <span className="truncate text-left">{selectedLabel}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className={joinClasses("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")}>
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

