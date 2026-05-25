"use client";

import { Dispatch, SetStateAction, useCallback, useState } from "react";

type PersistedTabOptions<TabId extends string> = {
  storageKey: string;
  defaultTab: TabId;
  validTabs: readonly TabId[];
};

function readPersistedTab<TabId extends string>({
  storageKey,
  defaultTab,
  validTabs,
}: PersistedTabOptions<TabId>) {
  if (typeof window === "undefined") {
    return defaultTab;
  }

  try {
    const storedTab = window.localStorage.getItem(storageKey);
    return storedTab && validTabs.includes(storedTab as TabId) ? (storedTab as TabId) : defaultTab;
  } catch {
    return defaultTab;
  }
}

export function usePersistedTab<TabId extends string>(
  options: PersistedTabOptions<TabId>,
): [TabId, Dispatch<SetStateAction<TabId>>] {
  const [activeTab, setActiveTabState] = useState<TabId>(() => readPersistedTab(options));

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

  return [activeTab, setActiveTab];
}
