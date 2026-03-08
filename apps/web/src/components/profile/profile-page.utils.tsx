import type { StoreOption } from "@/lib/store/catalog";
import {
  isThemePreference,
  type ThemePreference,
} from "@/lib/theme/preferences";

export function ProfileFallbackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="profile-page-avatar-icon">
      <path
        d="M12 12.2a4.1 4.1 0 1 0 0-8.2 4.1 4.1 0 0 0 0 8.2Zm0 1.9c-3.98 0-7.2 2.56-7.2 5.7 0 .44.36.8.8.8h12.8a.8.8 0 0 0 .8-.8c0-3.14-3.22-5.7-7.2-5.7Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function formatUnlockedDate(value?: string) {
  if (!value) {
    return "Unknown";
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return "Unknown";
  }
  return new Date(parsed).toLocaleDateString();
}

export function formatDateTime(value?: string) {
  if (!value) {
    return "Never";
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return "Never";
  }
  return new Date(parsed).toLocaleString();
}

export function toThemePreference(option: StoreOption): ThemePreference | null {
  if (!option.theme) {
    return null;
  }
  const preference = {
    optionId: option.id,
    primary: option.theme.primary,
    secondary: option.theme.secondary,
    tertiary: option.theme.tertiary,
  };
  return isThemePreference(preference) ? preference : null;
}
