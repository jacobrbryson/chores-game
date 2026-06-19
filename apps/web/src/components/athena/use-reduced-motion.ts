"use client";

import { useEffect, useState } from "react";

/**
 * Tracks the user's `prefers-reduced-motion` setting and keeps it live. Used by
 * the Athena experience to drop all decorative motion (sparkles, breathing,
 * floating icons, staggered reveals) when the user asks for reduced motion.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    // Safari < 14 only supports addListener.
    if (query.addEventListener) {
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    }
    query.addListener(onChange);
    return () => query.removeListener(onChange);
  }, []);

  return reduced;
}
