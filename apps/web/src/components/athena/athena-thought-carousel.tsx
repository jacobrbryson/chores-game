"use client";

import { useEffect, useState } from "react";

/**
 * Cycles through Athena's "thoughts" one line at a time with a gentle fade. The
 * message list can grow over time (the thinking panel adds pillar/personal lines
 * as the wait lengthens); we simply keep cycling whatever we're given. Under
 * reduced motion the line still changes, just without the fade transition.
 */
export function AthenaThoughtCarousel({
  messages,
  intervalMs = 2200,
  reducedMotion = false,
}: {
  messages: string[];
  intervalMs?: number;
  reducedMotion?: boolean;
}) {
  const [index, setIndex] = useState(0);
  // Bump a key on each change so the CSS fade-in animation re-runs.
  const [animKey, setAnimKey] = useState(0);

  useEffect(() => {
    if (messages.length <= 1) {
      return;
    }
    const timer = setInterval(() => {
      setIndex((current) => (current + 1) % messages.length);
      setAnimKey((current) => current + 1);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [messages.length, intervalMs]);

  const message = messages[index % Math.max(messages.length, 1)] ?? "";

  return (
    <p
      key={reducedMotion ? undefined : animKey}
      className={`athena-thought${reducedMotion ? "" : " athena-thought-animate"}`}
      aria-live="polite"
    >
      {message}
    </p>
  );
}
