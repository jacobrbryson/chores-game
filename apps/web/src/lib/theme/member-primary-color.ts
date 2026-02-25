import {
  DEFAULT_COLOR_THEME_OPTION_ID,
  findColorThemeOptionById,
  isAllowedDashboardColor,
  normalizeColor,
} from "@/lib/store/catalog";

export const DEFAULT_MEMBER_PRIMARY_COLOR =
  findColorThemeOptionById(DEFAULT_COLOR_THEME_OPTION_ID)?.theme.primary ?? "#2f8cff";

export function resolveMemberPrimaryColor(value: string | undefined) {
  if (!value) {
    return DEFAULT_MEMBER_PRIMARY_COLOR;
  }
  const normalized = normalizeColor(value);
  if (!isAllowedDashboardColor(normalized)) {
    return DEFAULT_MEMBER_PRIMARY_COLOR;
  }
  return normalized;
}

