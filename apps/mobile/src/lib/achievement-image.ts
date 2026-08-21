import { toAppAssetUrl } from "@/lib/api";

// React Native's <Image> cannot render SVG sources. The achievement catalog
// stores SVG art, so point at the pre-rendered PNG twin for the same name.
// These are plain static assets: the old /api/achievement-images route
// rasterized on demand from the public directory, which 404s in production
// because the deployed server ships without a local copy of that directory.
export function resolveAchievementImageUrl(url: string) {
  const normalized = url.trim();
  if (!normalized) {
    return "";
  }
  if (normalized.toLowerCase().endsWith(".svg")) {
    const rasterName = normalized.split("/").pop()?.replace(/\.svg$/i, ".png") ?? "";
    return rasterName ? toAppAssetUrl(`/achievements/placeholders-png/${rasterName}`) : "";
  }
  return toAppAssetUrl(normalized);
}

export function usesNativeSafeImage(url: string) {
  const normalized = url.trim().toLowerCase();
  return Boolean(normalized) && !normalized.endsWith(".svg");
}
