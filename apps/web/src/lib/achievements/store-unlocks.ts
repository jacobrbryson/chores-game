import { STORE_CATEGORIES, type StoreOptionKind } from "@/lib/store/catalog";

// Store-collection achievements are derived from the player's *current* owned
// set rather than from the single purchase that crossed the threshold. Crediting
// only the crossing purchase permanently stranded anyone who already owned
// items before these achievements shipped: their counters had no event left to
// fire. Because every value below is a maximum (target 1), recomputing them on
// each purchase is idempotent and back-fills the moment a player buys anything.
const UNLOCK_METRICS: Partial<
  Record<StoreOptionKind, { first: string; complete: string }>
> = {
  color: { first: "store_color_unlocks", complete: "store_color_collection_complete" },
  avatar: { first: "store_avatar_unlocks", complete: "store_avatar_collection_complete" },
  confetti: { first: "store_confetti_unlocks", complete: "store_confetti_collection_complete" },
};

// Maps every color/avatar/confetti unlock metric to 0 or 1 for the given owned
// set. All three kinds are evaluated on every purchase, not just the kind that
// was bought, so one purchase reconciles the whole group.
export function deriveStoreUnlockMaximums(ownedOptionIds: Set<string>): Record<string, number> {
  const maximums: Record<string, number> = {};
  for (const category of STORE_CATEGORIES) {
    const metrics = UNLOCK_METRICS[category.kind];
    if (!metrics) {
      continue;
    }
    // Default options are granted for free, so they never count as an unlock.
    const purchasableIds = category.options
      .filter((option) => !option.isDefault)
      .map((option) => option.id);
    const ownedCount = purchasableIds.filter((optionId) => ownedOptionIds.has(optionId)).length;
    // A category can appear more than once per kind; keep the best result.
    maximums[metrics.first] = Math.max(maximums[metrics.first] ?? 0, ownedCount > 0 ? 1 : 0);
    const complete = purchasableIds.length > 0 && ownedCount >= purchasableIds.length ? 1 : 0;
    maximums[metrics.complete] = Math.max(maximums[metrics.complete] ?? 0, complete);
  }
  return maximums;
}
