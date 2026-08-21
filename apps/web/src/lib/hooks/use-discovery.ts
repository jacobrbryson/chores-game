"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { dedupedFetch } from "@/lib/api/deduped-fetch";

// Client-side discovery (What's New) helpers. Keep all discovery fetches behind
// these helpers instead of scattering raw fetch calls across components.

export type DiscoverySectionSummary = {
  sectionKey: string;
  count: number;
  lastSeenAt: string | null;
  label: string;
  children?: Record<string, DiscoverySectionSummary>;
};

export type DiscoverySummary = {
  sections: Record<string, DiscoverySectionSummary>;
  totalCount: number;
};

const EMPTY_SUMMARY: DiscoverySummary = { sections: {}, totalCount: 0 };

// Window event other features (and mark-seen) dispatch to ask discovery
// consumers to refresh.
export const DISCOVERY_REFRESH_EVENT = "discovery:refresh";

// Marks discovery sections seen for the active profile. Fails soft (never
// throws) so navigation is never blocked, then notifies consumers to refresh.
export async function markDiscoverySeen(sections: string[]): Promise<void> {
  const unique = Array.from(new Set(sections.filter(Boolean)));
  if (unique.length === 0) {
    return;
  }
  try {
    await fetch("/api/discovery/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sections: unique }),
      cache: "no-store",
    });
  } catch {
    // Ignore — mark-seen must not block navigation.
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(DISCOVERY_REFRESH_EVENT));
  }
}

// Convenience: mark sections seen once a surface becomes visibly active. Used by
// pages/tabs to clear their badge on actual view (not while hidden/mounted).
export function useMarkDiscoverySeen(sections: string[], active = true): void {
  // Stable key so the effect only re-fires when the section set or active state
  // meaningfully changes.
  const key = sections.join(",");
  useEffect(() => {
    if (!active || !key) {
      return;
    }
    void markDiscoverySeen(key.split(","));
  }, [key, active]);
}

export function useDiscoverySummary(
  sections?: string[],
  options?: { enabled?: boolean },
): {
  summary: DiscoverySummary;
  loading: boolean;
  refresh: () => void;
} {
  const enabled = options?.enabled ?? true;
  const [summary, setSummary] = useState<DiscoverySummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const sectionsKey = sections && sections.length > 0 ? sections.join(",") : "";
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    if (!enabled) {
      return;
    }
    seqRef.current += 1;
    const seq = seqRef.current;
    try {
      const query = sectionsKey ? `?sections=${encodeURIComponent(sectionsKey)}` : "";
      const response = await dedupedFetch(`/api/discovery/summary${query}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`DISCOVERY_HTTP_${response.status}`);
      }
      const payload = (await response.json()) as DiscoverySummary;
      if (seq === seqRef.current) {
        setSummary({
          sections: payload.sections ?? {},
          totalCount: payload.totalCount ?? 0,
        });
      }
    } catch {
      // Fail soft: leave the last good summary; badges simply don't update.
      if (seq === seqRef.current) {
        setSummary((current) => current);
      }
    } finally {
      if (seq === seqRef.current) {
        setLoading(false);
      }
    }
  }, [sectionsKey, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  // Refresh on discovery changes, family activity (new chores, etc.), and when
  // the tab regains focus.
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handler = () => void load();
    window.addEventListener(DISCOVERY_REFRESH_EVENT, handler);
    window.addEventListener("notifications:refresh", handler);
    window.addEventListener("focus", handler);
    return () => {
      window.removeEventListener(DISCOVERY_REFRESH_EVENT, handler);
      window.removeEventListener("notifications:refresh", handler);
      window.removeEventListener("focus", handler);
    };
  }, [load]);

  return { summary, loading, refresh: () => void load() };
}

export function getSectionCount(summary: DiscoverySummary, sectionKey: string): number {
  const top = summary.sections[sectionKey];
  if (top) {
    return top.count;
  }
  for (const parent of Object.values(summary.sections)) {
    const child = parent.children?.[sectionKey];
    if (child) {
      return child.count;
    }
  }
  return 0;
}
