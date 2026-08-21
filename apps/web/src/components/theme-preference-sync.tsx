"use client";

import { dedupedFetch } from "@/lib/api/deduped-fetch";
import { useEffect } from "react";
import {
	THEME_CHANGED_EVENT,
	THEME_RESET_EVENT,
	applyDefaultThemePreference,
	applyThemePreference,
	clearStoredThemePreference,
	isThemePreference,
	readStoredThemePreference,
	type ThemePreference,
	writeStoredThemePreference,
} from "@/lib/theme/preferences";

type PreferencesResponse = {
	themeOptionId?: unknown;
	themePrimaryColor?: unknown;
	themeSecondaryColor?: unknown;
	themeTertiaryColor?: unknown;
};

function preferenceFromApiResponse(payload: PreferencesResponse): ThemePreference | null {
	const preference = {
		optionId:
			typeof payload.themeOptionId === "string" ? payload.themeOptionId.trim() : "",
		primary:
			typeof payload.themePrimaryColor === "string" ? payload.themePrimaryColor : "",
		secondary:
			typeof payload.themeSecondaryColor === "string"
				? payload.themeSecondaryColor
				: "",
		tertiary:
			typeof payload.themeTertiaryColor === "string" ? payload.themeTertiaryColor : "",
	};
	if (!isThemePreference(preference)) {
		return null;
	}
	return preference;
}

export function ThemePreferenceSync() {
	useEffect(() => {
		let cancelled = false;
		const localPreference = readStoredThemePreference();
		if (localPreference) {
			applyThemePreference(localPreference);
		} else {
			applyDefaultThemePreference();
		}

		async function loadServerPreference() {
			try {
				const response = await dedupedFetch("/api/preferences", { cache: "no-store" });
				if (!response.ok || cancelled) {
					return;
				}
				const payload = (await response.json()) as PreferencesResponse;
				if (cancelled) {
					return;
				}
				const serverPreference = preferenceFromApiResponse(payload);
				if (serverPreference) {
					applyThemePreference(serverPreference);
					writeStoredThemePreference(serverPreference);
					return;
				}
				clearStoredThemePreference();
				applyDefaultThemePreference();
			} catch {
				// Keep local fallback on transient failures.
			}
		}

		void loadServerPreference();

		function onThemeChanged(event: Event) {
			const customEvent = event as CustomEvent<ThemePreference>;
			if (!isThemePreference(customEvent.detail)) {
				return;
			}
			applyThemePreference(customEvent.detail);
			writeStoredThemePreference(customEvent.detail);
		}

		function onThemeReset() {
			clearStoredThemePreference();
			applyDefaultThemePreference();
		}

		window.addEventListener(THEME_CHANGED_EVENT, onThemeChanged as EventListener);
		window.addEventListener(THEME_RESET_EVENT, onThemeReset);

		return () => {
			cancelled = true;
			window.removeEventListener(
				THEME_CHANGED_EVENT,
				onThemeChanged as EventListener,
			);
			window.removeEventListener(THEME_RESET_EVENT, onThemeReset);
		};
	}, []);

	return null;
}
