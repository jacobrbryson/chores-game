"use client";

import { AthenaAvatar } from "@/components/athena/athena-avatar";

/**
 * AthenaFallbackState — Athena's voice for the "nothing new" and "can't gather
 * ideas right now" moments. Never surfaces technical errors; always encouraging.
 * Shown briefly before (or instead of) traditional suggestions.
 */
export function AthenaFallbackState({
  message,
  reducedMotion = false,
}: {
  message: string;
  reducedMotion?: boolean;
}) {
  return (
    <div
      className={reducedMotion ? "athena-fallback" : "athena-fallback athena-fallback-animate"}
      role="status"
      aria-live="polite"
    >
      <AthenaAvatar size={48} thinking={false} />
      <p className="athena-fallback-message">{message}</p>
    </div>
  );
}
