// The Responsibility Identity selection helpers (earned-identity rule, the
// top-titles ordering, and the journey pillar) live in @packages/core so the web
// identity surfaces and their mobile counterparts share one implementation.
// Re-exported here so existing `@/lib/responsibility/identity` imports keep
// working.
export {
  hasEarnedIdentity,
  primaryJourneyPillar,
  topEarnedIdentities,
  type PillarIdentity,
} from "@packages/core";
