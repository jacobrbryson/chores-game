"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

export type TailwindSelectOption<T extends string = string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

type TailwindSelectProps<T extends string = string> = {
  ariaLabel: string;
  options: TailwindSelectOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  disabled?: boolean;
};

function joinClasses(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(" ");
}

export function TailwindSelect<T extends string = string>({
  ariaLabel,
  options,
  value,
  onChange,
  className,
  buttonClassName,
  menuClassName,
  disabled = false,
}: TailwindSelectProps<T>) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedIndex = useMemo(
    () => options.findIndex((option) => option.value === value),
    [options, value],
  );
  const firstEnabledIndex = useMemo(
    () => options.findIndex((option) => !option.disabled),
    [options],
  );
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(
    selectedIndex >= 0 ? selectedIndex : firstEnabledIndex,
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (!rootRef.current?.contains(target)) {
        setOpen(false);
      }
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
    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : firstEnabledIndex);
  }, [firstEnabledIndex, open, selectedIndex]);

  const selectedLabel =
    selectedIndex >= 0 ? options[selectedIndex]?.label : options[firstEnabledIndex]?.label ?? "";

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

  function commitIndex(index: number) {
    if (index < 0 || !options[index] || options[index]?.disabled) {
      return;
    }
    onChange(options[index].value);
    setOpen(false);
  }

  function onButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : firstEnabledIndex);
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
        setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : firstEnabledIndex);
        return;
      }
      const previous = findNextEnabledIndex(highlightedIndex, -1);
      if (previous >= 0) {
        setHighlightedIndex(previous);
      }
      return;
    }
    if (event.key === "Enter" && open) {
      event.preventDefault();
      commitIndex(highlightedIndex);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className={joinClasses("relative", className)}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        disabled={disabled}
        className={joinClasses(
          "theme-select-trigger",
          buttonClassName,
        )}
        onKeyDown={onButtonKeyDown}
        onClick={() => setOpen((current) => !current)}>
        <span className="truncate text-left">{selectedLabel}</span>
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
      {open ? (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className={joinClasses(
            "absolute z-40 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg",
            menuClassName,
          )}>
          {options.map((option, index) => {
            const active = index === highlightedIndex;
            const selected = option.value === value;
            return (
              <li key={option.value} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={option.disabled}
                  className={joinClasses(
                    "theme-select-option",
                    active && !option.disabled && "theme-select-option-active",
                    selected && !option.disabled && "theme-select-option-selected",
                    option.disabled && "cursor-not-allowed opacity-60",
                  )}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => commitIndex(index)}>
                  {option.label}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
