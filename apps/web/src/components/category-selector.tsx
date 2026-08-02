"use client";

import { BUG_CATEGORY_KEYS, FEATURE_CATEGORY_KEYS } from "@/lib/support/requests";
import type { SupportRequestType } from "@/lib/support/requests";

const CUSTOM_SENTINEL = "__custom__";

/** Returns true when `value` is one of the pre-loaded category keys. */
export function isKnownCategoryKey(value: string): boolean {
  return (
    (FEATURE_CATEGORY_KEYS as readonly string[]).includes(value) ||
    (BUG_CATEGORY_KEYS as readonly string[]).includes(value)
  );
}

type Props = {
  type: SupportRequestType;
  value: string;
  onChange: (value: string) => void;
  /** Renders each known key as a label. Falls back to a plain title-cased key. */
  labelFor: (key: string) => string;
  selectClassName?: string;
  inputClassName?: string;
  placeholder?: string;
  customPlaceholder?: string;
  customLabel?: string;
};

/**
 * Renders a <select> showing the pre-loaded category keys for the given
 * request type, translated via `labelFor`. When the user picks "Other /
 * Custom…" a plain text input appears, letting admins invent new categories
 * on the fly. The `value` / `onChange` contract always deals with the stored
 * string (the key for pre-loaded categories, or the raw custom text).
 */
export function CategorySelector({
  type,
  value,
  onChange,
  labelFor,
  selectClassName = "",
  inputClassName = "",
  placeholder = "Select a category (optional)",
  customPlaceholder = "Enter a custom category…",
  customLabel = "Custom category",
}: Props) {
  const keys = (type === "bug" ? BUG_CATEGORY_KEYS : FEATURE_CATEGORY_KEYS).filter(
    (key) => !key.includes("quest"),
  );
  const isCustom = value !== "" && !isKnownCategoryKey(value);
  const selectValue = isCustom ? CUSTOM_SENTINEL : value;

  function handleSelectChange(next: string) {
    if (next === CUSTOM_SENTINEL) {
      // Keep any existing custom text; otherwise clear to let the user type.
      onChange(isCustom ? value : "");
    } else {
      onChange(next);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <select
        value={selectValue}
        onChange={(e) => handleSelectChange(e.target.value)}
        className={selectClassName}
      >
        <option value="">{placeholder}</option>
        {keys.map((key) => (
          <option key={key} value={key}>
            {labelFor(key)}
          </option>
        ))}
        <option value={CUSTOM_SENTINEL}>Other / Custom…</option>
      </select>

      {isCustom ? (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={customPlaceholder}
          aria-label={customLabel}
          maxLength={100}
          className={inputClassName}
        />
      ) : null}
    </div>
  );
}
