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

function readStoredTab<TabId extends string>(
  storageKey: string,
  validTabs: readonly TabId[],
): TabId | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const storedTab = window.localStorage.getItem(storageKey);
    return storedTab && validTabs.includes(storedTab as TabId) ? (storedTab as TabId) : null;
  } catch {
    return null;
  }
}

export function usePersistedTab<TabId extends string>(
  options: PersistedTabOptions<TabId>,
): [TabId, Dispatch<SetStateAction<TabId>>] {
  const { storageKey, defaultTab, validTabs, urlParamKey } = options;

  // Always initialize to the default so server and first client render agree. Reading
  // localStorage during render causes a hydration mismatch, which React resolves by
  // throwing away the client value and snapping back to the server-rendered default —
  // i.e. the stored tab would never stick. We resolve the persisted/deep-linked value in
  // the mount effect below instead.
  const [activeTab, setActiveTabState] = useState<TabId>(defaultTab);

  const setActiveTab = useCallback<Dispatch<SetStateAction<TabId>>>(
    (nextValue) => {
      setActiveTabState((current) => {
        const resolvedValue =
          typeof nextValue === "function"
            ? (nextValue as (currentValue: TabId) => TabId)(current)
            : nextValue;
        const safeValue = validTabs.includes(resolvedValue) ? resolvedValue : defaultTab;

        try {
          window.localStorage.setItem(storageKey, safeValue);
        } catch {
          // Ignore storage failures; tab switching should still work.
        }

        return safeValue;
      });
    },
    [storageKey, defaultTab, validTabs],
  );

  // Resolve the persisted (or deep-linked) tab after mount. Keyed on storageKey so it also
  // re-resolves when the viewer changes (e.g. switching managed-child profiles), restoring
  // that viewer's last selection. URL `?tab=` wins over the stored value when present.
  useEffect(() => {
    const resolved = readUrlTab(urlParamKey, validTabs) ?? readStoredTab(storageKey, validTabs);
    if (resolved) {
      // setState directly (not setActiveTab) so we don't re-write the same value back.
      setActiveTabState(resolved);
    } else {
      setActiveTabState(defaultTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  return [activeTab, setActiveTab];
}
