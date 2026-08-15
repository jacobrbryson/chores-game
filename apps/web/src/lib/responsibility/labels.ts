// Client-safe label helpers. The pillar label, select-option builder, and the
// identity title label are shared with mobile via @packages/core; re-exported
// here so existing `@/lib/responsibility/labels` imports keep working.
export {
  responsibilityPillarLabel,
  responsibilityPillarSelectOptions,
  responsibilityTitleLabel,
} from "@packages/core";
