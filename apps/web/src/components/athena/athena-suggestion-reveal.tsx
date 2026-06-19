"use client";

import { Children, type ReactNode, useEffect, useState } from "react";
import { AthenaAvatar } from "@/components/athena/athena-avatar";

/**
 * AthenaSuggestionReveal — after Athena "reacts" with a short headline, the
 * suggestion cards arrive one at a time (each sliding up + fading in + a single
 * sparkle), making the result feel intentional and rewarding rather than a hard
 * swap from a loading state. Under reduced motion every card shows at once.
 */
export function AthenaSuggestionReveal({
  headline,
  reducedMotion = false,
  stepMs = 300,
  children,
}: {
  headline: string;
  reducedMotion?: boolean;
  stepMs?: number;
  children: ReactNode;
}) {
  const items = Children.toArray(children);
  const [visibleCount, setVisibleCount] = useState(reducedMotion ? items.length : 0);

  useEffect(() => {
    if (reducedMotion) {
      setVisibleCount(items.length);
      return;
    }
    setVisibleCount(0);
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    // First card lands shortly after the headline; the rest follow every stepMs.
    for (let i = 0; i < items.length; i += 1) {
      timers.push(
        setTimeout(() => {
          if (!cancelled) {
            setVisibleCount((current) => Math.max(current, i + 1));
          }
        }, 250 + i * stepMs),
      );
    }
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [items.length, reducedMotion, stepMs]);

  // Children are full <li> cards supplied by the caller (so existing card styles
  // are preserved). We only control how many are mounted; each card animates
  // itself in via its own `athena-reveal-animate` class when it mounts.
  return (
    <div className="athena-reveal">
      <div className="athena-reveal-header">
        <AthenaAvatar size={40} celebrating={!reducedMotion} />
        <p className="athena-reveal-headline">{headline}</p>
      </div>
      <ul className="family-list ghost-suggestions-empty-list">{items.slice(0, visibleCount)}</ul>
    </div>
  );
}
