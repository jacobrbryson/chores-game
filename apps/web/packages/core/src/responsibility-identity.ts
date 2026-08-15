// Responsibility Identity selection helpers. These shape the per-pillar title
// progress (computed in the service / titles module) into the compact views
// surfaced across the app: profile cards, kiosk/switch chips, the dashboard
// "Your Journey" widget, and the parent "Family Growth" section.
//
// This lives in @packages/core because web and mobile render the same identity
// surfaces — which title is "current", which pillar leads the journey widget,
// and the earned-vs-not rule must not drift between the two apps.
import type { ResponsibilityPillar } from "./responsibility-pillars";

// One pillar's identity snapshot: the title the child currently holds plus how
// close they are to the next one. A subset of `ResponsibilityPillarProgress`.
export type PillarIdentity = {
  pillar: ResponsibilityPillar;
  level?: number;
  titleTier: number;
  nextTitleTier: number | null;
  titleProgressFraction: number;
  xp: number;
};

// Minimal shape these helpers need — satisfied by `ResponsibilityPillarProgress`
// and by the batch identities API payload.
type PillarProgressLike = PillarIdentity;

// A title becomes an earned identity after the child advances beyond the
// starter level for that pillar. Older payloads did not include level, so fall
// back to the original xp-started rule only when level is unavailable.
export function hasEarnedIdentity(entry: PillarProgressLike): boolean {
  return typeof entry.level === "number" ? entry.level > 1 : entry.xp > 0;
}

// The pillars where a child has earned an identity, ordered by the title they
// hold (highest tier first) then by XP. Used wherever we show "who they are":
// profile cards and selection chips. `limit` caps how many to display.
export function topEarnedIdentities<T extends PillarProgressLike>(
  pillars: readonly T[],
  limit?: number,
): T[] {
  const earned = pillars
    .filter(hasEarnedIdentity)
    .sort((a, b) => b.titleTier - a.titleTier || b.xp - a.xp);
  return typeof limit === "number" ? earned.slice(0, Math.max(0, limit)) : earned;
}

// The pillar to feature in the dashboard "Your Journey" widget: the one the
// child is most invested in (highest XP). Returns null when nothing is started.
export function primaryJourneyPillar<T extends PillarProgressLike>(
  pillars: readonly T[],
): T | null {
  let best: T | null = null;
  for (const entry of pillars) {
    if (entry.xp > 0 && (!best || entry.xp > best.xp)) {
      best = entry;
    }
  }
  return best;
}

// Localized identity title name for a pillar + 0-based title tier. Title names
// live under the `responsibility.titles.<pillar>.<tier>` locale keys, which are
// present in every locale file both apps load.
export function responsibilityTitleLabel(
  pillar: ResponsibilityPillar,
  tier: number,
  t: (key: string) => string,
) {
  return t(`responsibility.titles.${pillar}.${tier}`);
}
