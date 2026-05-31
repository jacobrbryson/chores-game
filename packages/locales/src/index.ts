import enUS from "./en-US.json";
import frFR from "./fr-FR.json";
import esUS from "./es-US.json";

export const SUPPORTED_LOCALES = ["fr-FR", "en-US", "es-US"] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "en-US";

export const LOCALE_LABELS: Record<AppLocale, string> = {
  "fr-FR": "Français",
  "en-US": "English (US)",
  "es-US": "Español (US)",
};

export const localeMessages = {
  "fr-FR": frFR,
  "en-US": enUS,
  "es-US": esUS,
} as const satisfies Record<AppLocale, typeof enUS>;

type TranslationTree = typeof enUS;
export type TranslationKey = string;

export type TranslationParams = Record<string, string | number>;

function getMessage(messages: TranslationTree, key: TranslationKey): string | null {
  const parts = key.split(".");
  let current: unknown = messages;
  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : null;
}

export function isSupportedLocale(value: string | null | undefined): value is AppLocale {
  return SUPPORTED_LOCALES.includes(value as AppLocale);
}

export function normalizeLocale(value: string | null | undefined): AppLocale | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return isSupportedLocale(trimmed) ? trimmed : null;
}

export function resolveLocalePreference(input: {
  requestedLocale?: string | null;
  familyLocale?: string | null;
  fallbackLocale?: string | null;
}): AppLocale {
  return (
    normalizeLocale(input.requestedLocale) ||
    normalizeLocale(input.familyLocale) ||
    normalizeLocale(input.fallbackLocale) ||
    DEFAULT_LOCALE
  );
}

function interpolate(template: string, params?: TranslationParams) {
  if (!params) {
    return template;
  }
  return template.replace(/\{([^}]+)\}/g, (_match, token: string) => {
    const value = params[token];
    return value === undefined ? `{${token}}` : String(value);
  });
}

function uniqueLocales(locales: AppLocale[]) {
  return Array.from(new Set(locales));
}

export function createTranslator(input: {
  locale: AppLocale;
  familyLocale?: AppLocale | null;
  fallbackLocale?: AppLocale | null;
  onMissingKey?: (key: TranslationKey, locale: AppLocale) => void;
}) {
  const chain = uniqueLocales([
    input.locale,
    input.familyLocale || DEFAULT_LOCALE,
    input.fallbackLocale || DEFAULT_LOCALE,
    DEFAULT_LOCALE,
  ]);

  return function t(key: TranslationKey, params?: TranslationParams) {
    for (const locale of chain) {
      const template = getMessage(localeMessages[locale], key);
      if (template !== null) {
        return interpolate(template, params);
      }
    }
    input.onMissingKey?.(key, input.locale);
    return key;
  };
}
