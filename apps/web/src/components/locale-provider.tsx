"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  createTranslator,
  DEFAULT_LOCALE,
  isSupportedLocale,
  type AppLocale,
  type TranslationKey,
  type TranslationParams,
} from "@packages/locales";

type LocaleContextValue = {
  locale: AppLocale;
  t: (key: TranslationKey, params?: TranslationParams) => string;
  setLocale: (locale: AppLocale) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function dispatchAppLocaleChanged(locale: AppLocale) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent("app-locale:changed", { detail: { locale } }));
}

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: AppLocale;
  children: ReactNode;
}) {
  const [locale, setLocale] = useState<AppLocale>(initialLocale || DEFAULT_LOCALE);

  useEffect(() => {
    function onLocaleChanged(event: Event) {
      const nextLocale =
        event instanceof CustomEvent && typeof event.detail?.locale === "string"
          ? event.detail.locale
          : "";
      if (isSupportedLocale(nextLocale)) {
        setLocale(nextLocale);
      }
    }

    window.addEventListener("app-locale:changed", onLocaleChanged);
    return () => {
      window.removeEventListener("app-locale:changed", onLocaleChanged);
    };
  }, []);

  const value = useMemo<LocaleContextValue>(() => {
    const t = createTranslator({
      locale,
      onMissingKey: (key, currentLocale) => {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[I18N_MISSING_KEY]", currentLocale, key);
        }
      },
    });
    return {
      locale,
      t,
      setLocale,
    };
  }, [locale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const value = useContext(LocaleContext);
  if (!value) {
    throw new Error("useLocale must be used within LocaleProvider");
  }
  return value;
}
