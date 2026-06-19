"use client";

/**
 * Athena's avatar: a glowing, breathing orb with a sparkle face that blinks.
 * Pure CSS animation (see globals.css `.athena-avatar*`), so it stays at 60fps
 * and goes completely still under `prefers-reduced-motion`.
 */
export function AthenaAvatar({
  size = 96,
  thinking = false,
  celebrating = false,
}: {
  size?: number;
  thinking?: boolean;
  celebrating?: boolean;
}) {
  const className = [
    "athena-avatar",
    thinking ? "is-thinking" : "",
    celebrating ? "is-celebrating" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={className} style={{ width: size, height: size }} aria-hidden="true">
      <span className="athena-avatar-glow" />
      <span className="athena-avatar-core">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v2" />
          <path d="M12 19v2" />
          <path d="M5 12H3" />
          <path d="M21 12h-2" />
          <circle cx="12" cy="12" r="4" className="athena-avatar-eye" />
          <path d="m6.3 6.3 1.4 1.4" />
          <path d="m16.3 16.3 1.4 1.4" />
        </svg>
      </span>
    </span>
  );
}
