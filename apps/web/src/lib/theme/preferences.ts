import {
	DEFAULT_COLOR_THEME_OPTION_ID,
	isAllowedDashboardColor,
	normalizeThemePalette,
	type ThemePalette,
} from "@/lib/store/catalog";

export type ThemePreference = ThemePalette & {
	optionId: string;
};

export const DEFAULT_THEME_PREFERENCE: ThemePreference = {
	optionId: DEFAULT_COLOR_THEME_OPTION_ID,
	primary: "#0072b2",
	secondary: "#56b4e9",
	tertiary: "#1b2a41",
};

export const THEME_PREFERENCE_STORAGE_KEY = "preferences_theme_palette_v1";
export const THEME_CHANGED_EVENT = "theme:changed";
export const THEME_RESET_EVENT = "theme:reset";

type RgbColor = {
	r: number;
	g: number;
	b: number;
};

function clampRgb(value: number) {
	return Math.max(0, Math.min(255, Math.round(value)));
}

function hexToRgb(value: string): RgbColor | null {
	const normalized = value.trim().toLowerCase();
	if (!/^#[0-9a-f]{6}$/.test(normalized)) {
		return null;
	}
	const raw = normalized.slice(1);
	const r = Number.parseInt(raw.slice(0, 2), 16);
	const g = Number.parseInt(raw.slice(2, 4), 16);
	const b = Number.parseInt(raw.slice(4, 6), 16);
	if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
		return null;
	}
	return { r, g, b };
}

function rgbToHex(color: RgbColor) {
	const toHex = (value: number) => clampRgb(value).toString(16).padStart(2, "0");
	return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
}

function mixHex(base: string, blend: string, blendWeight: number) {
	const baseRgb = hexToRgb(base);
	const blendRgb = hexToRgb(blend);
	if (!baseRgb || !blendRgb) {
		return base;
	}
	const weight = Math.max(0, Math.min(1, blendWeight));
	return rgbToHex({
		r: baseRgb.r * (1 - weight) + blendRgb.r * weight,
		g: baseRgb.g * (1 - weight) + blendRgb.g * weight,
		b: baseRgb.b * (1 - weight) + blendRgb.b * weight,
	});
}

function normalizeThemePreference(value: ThemePreference): ThemePreference {
	const palette = normalizeThemePalette(value);
	return {
		optionId: value.optionId.trim(),
		primary: palette.primary,
		secondary: palette.secondary,
		tertiary: palette.tertiary,
	};
}

export function isThemePreference(value: unknown): value is ThemePreference {
	if (!value || typeof value !== "object") {
		return false;
	}
	const preference = value as ThemePreference;
	return (
		typeof preference.optionId === "string" &&
		preference.optionId.trim().length > 0 &&
		isAllowedDashboardColor(preference.primary) &&
		isAllowedDashboardColor(preference.secondary) &&
		isAllowedDashboardColor(preference.tertiary)
	);
}

export function applyThemePreference(value: ThemePreference | ThemePalette) {
	if (typeof document === "undefined") {
		return;
	}
	const theme: ThemePalette =
		"optionId" in value
			? {
					primary: value.primary,
					secondary: value.secondary,
					tertiary: value.tertiary,
				}
			: value;
	const palette = normalizeThemePalette(theme);
	const root = document.documentElement;
	const tertiaryRgb = hexToRgb(palette.tertiary);
	root.style.setProperty("--theme-primary", palette.primary);
	root.style.setProperty("--theme-secondary", palette.secondary);
	root.style.setProperty("--theme-tertiary", palette.tertiary);
	root.style.setProperty("--brand", palette.primary);
	root.style.setProperty("--brand-strong", mixHex(palette.primary, "#000000", 0.18));
	root.style.setProperty("--brand-ink", mixHex(palette.tertiary, "#000000", 0.2));
	root.style.setProperty("--accent", palette.secondary);
	root.style.setProperty("--accent-soft", mixHex(palette.secondary, "#ffffff", 0.86));
	root.style.setProperty("--foreground", palette.tertiary);
	root.style.setProperty("--muted", mixHex(palette.tertiary, "#ffffff", 0.36));
	root.style.setProperty("--background", mixHex(palette.primary, "#ffffff", 0.92));
	root.style.setProperty("--background-soft", mixHex(palette.primary, "#ffffff", 0.86));
	root.style.setProperty("--line", mixHex(palette.primary, "#ffffff", 0.74));
	if (tertiaryRgb) {
		root.style.setProperty(
			"--shadow",
			`0 16px 44px rgba(${tertiaryRgb.r}, ${tertiaryRgb.g}, ${tertiaryRgb.b}, 0.14)`,
		);
	}
}

export function applyDefaultThemePreference() {
	applyThemePreference(DEFAULT_THEME_PREFERENCE);
}

export function readStoredThemePreference() {
	if (typeof window === "undefined") {
		return null;
	}
	try {
		const raw = window.localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY);
		if (!raw) {
			return null;
		}
		const parsed: unknown = JSON.parse(raw);
		if (!isThemePreference(parsed)) {
			return null;
		}
		return normalizeThemePreference(parsed);
	} catch {
		return null;
	}
}

export function writeStoredThemePreference(value: ThemePreference) {
	if (typeof window === "undefined") {
		return;
	}
	try {
		window.localStorage.setItem(
			THEME_PREFERENCE_STORAGE_KEY,
			JSON.stringify(normalizeThemePreference(value)),
		);
	} catch {
		// Ignore storage failures.
	}
}

export function clearStoredThemePreference() {
	if (typeof window === "undefined") {
		return;
	}
	try {
		window.localStorage.removeItem(THEME_PREFERENCE_STORAGE_KEY);
	} catch {
		// Ignore storage failures.
	}
}

export function dispatchThemeChanged(value: ThemePreference) {
	if (typeof window === "undefined") {
		return;
	}
	window.dispatchEvent(
		new CustomEvent<ThemePreference>(THEME_CHANGED_EVENT, {
			detail: normalizeThemePreference(value),
		}),
	);
}

export function dispatchThemeReset() {
	if (typeof window === "undefined") {
		return;
	}
	window.dispatchEvent(new Event(THEME_RESET_EVENT));
}
