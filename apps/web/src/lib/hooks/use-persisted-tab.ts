"use client";

import { Dispatch, SetStateAction, useCallback, useEffect, useState } from "react";

type PersistedTabOptions<TabId extends string> = {
  storageKey: string;
  defaultTab: TabId;
  validTabs: readonly TabId[];
  // When set, a matching URL query param (e.g. `?tab=awards`) selects that tab on
  // load, taking precedence over the stored value. Enables tab deep links.
  urlParamKey?: string;
};

function readUrlTab<TabId extends string>(
  urlParamKey: string | undefined,
  validTabs: readonly TabId[],
): TabId | null {
  if (typeof window === "undefined" || !urlParamKey) {
    return null;
  }
  try {
    const urlTab = new URLSearchParams(window.location.search).get(urlParamKey);
    return urlTab && validTabs.includes(urlTab as TabId) ? (urlTab as TabId) : null;
  } catch {
    return null;
  }
}

function readInitialTab<TabId extends string>({
  storageKey,
  defaultTab,
  validTabs,
  urlParamKey,
}: PersistedTabOptions<TabId>) {
  if (typeof window === "undefined") {
    return defaultTab;
  }

  try {
    const urlTab = readUrlTab(urlParamKey, validTabs);
    if (urlTab) {
      return urlTab;
    }
    const storedTab = window.localStorage.getItem(storageKey);
    return storedTab && validTabs.includes(storedTab as TabId) ? (storedTab as TabId) : defaultTab;
  } catch {
    return defaultTab;
  }
}

export function usePersistedTab<TabId extends string>(
  options: PersistedTabOptions<TabId>,
): [TabId, Dispatch<SetStateAction<TabId>>] {
  const [activeTab, setActiveTabState] = useState<TabId>(() => readInitialTab(options));

  const setActiveTab = useCallback<Dispatch<SetStateAction<TabId>>>(
    (nextValue) => {
      setActiveTabState((current) => {
        const resolvedValue =
          typeof nextValue === "function"
            ? (nextValue as (currentValue: TabId) => TabId)(current)
            : nextValue;
        const safeValue = options.validTabs.includes(resolvedValue) ? resolvedValue : options.defaultTab;

        try {
          window.localStorage.setItem(options.storageKey, safeValue);
        } catch {
          // Ignore storage failures; tab switching should still work.
        }

        return safeValue;
      });
    },
    [options],
  );

  // Reliable deep-link handling: the render-time initializer can read a stale
  // URL during an App Router client transition (falling back to the stored tab).
  // This mount effect re-reads the committed URL and honors `?tab=` if present.
  useEffect(() => {
    const urlTab = readUrlTab(options.urlParamKey, options.validTabs);
    if (urlTab) {
      setActiveTab(urlTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return [activeTab, setActiveTab];
}
