/**
 * Centralized SEO constants. The canonical production origin lives here so the
 * sitemap, robots, metadataBase, and per-page canonical URLs never drift apart.
 */
export const SITE_URL = "https://family-chores.app";

/** Default social-share image used when a page does not provide its own. */
export const DEFAULT_OG_IMAGE = "/hero-bg.png";

/** Absolute URL helper for canonical/OpenGraph fields. */
export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
