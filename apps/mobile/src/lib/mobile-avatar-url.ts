function trimTrailingSlash(value: string) {
  return value.replace(/\/$/, "");
}

/**
 * Resolve app-hosted avatars against the origin configured by the mobile app.
 *
 * Next.js can build an absolute URL from an internal/proxy request host (for
 * example localhost). That URL works in a browser running beside the server,
 * but localhost points at the phone when React Native loads it. Re-homing known
 * app avatar paths keeps remote Google/custom-photo URLs unchanged.
 */
export function resolveMobileAvatarUrl(value: string | undefined, appOrigin: string) {
  const avatarUrl = value?.trim() ?? "";
  if (!avatarUrl) {
    return "";
  }

  const normalizedOrigin = trimTrailingSlash(appOrigin.trim());
  try {
    const parsed = new URL(avatarUrl, `${normalizedOrigin}/`);
    if (parsed.pathname.startsWith("/avatars/default/")) {
      return `${normalizedOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    // Preserve malformed/exotic image sources so AvatarBadge can fall back.
  }

  return avatarUrl;
}
