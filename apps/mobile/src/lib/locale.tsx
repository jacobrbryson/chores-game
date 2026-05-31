import React, { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import {
  createTranslator,
  DEFAULT_LOCALE,
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

export function MobileLocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: AppLocale;
  children: ReactNode;
}) {
  const [locale, setLocale] = useState<AppLocale>(initialLocale || DEFAULT_LOCALE);

  const value = useMemo<LocaleContextValue>(() => {
    const t = createTranslator({
      locale,
      onMissingKey: (key, currentLocale) => {
        if (__DEV__) {
          console.warn("[I18N_MISSING_KEY]", currentLocale, key);
        }
      },
    });
    return { locale, t, setLocale };
  }, [locale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useMobileLocale() {
  const value = useContext(LocaleContext);
  if (!value) {
    throw new Error("useMobileLocale must be used within MobileLocaleProvider");
  }
  return value;
}
