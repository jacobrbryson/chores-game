import { describe, expect, it } from "vitest";
import { STORE_CATEGORIES } from "@/lib/store/catalog";
import { deriveStoreUnlockMaximums } from "./store-unlocks";

function purchasableIdsForKind(kind: string) {
  return STORE_CATEGORIES.filter((category) => category.kind === kind).flatMap((category) =>
    category.options.filter((option) => !option.isDefault).map((option) => option.id),
  );
}

describe("deriveStoreUnlockMaximums", () => {
  it("reports nothing unlocked for an empty owned set", () => {
    const result = deriveStoreUnlockMaximums(new Set());
    expect(result.store_color_unlocks).toBe(0);
    expect(result.store_avatar_unlocks).toBe(0);
    expect(result.store_confetti_unlocks).toBe(0);
    expect(result.store_color_collection_complete).toBe(0);
    expect(result.store_avatar_collection_complete).toBe(0);
    expect(result.store_confetti_collection_complete).toBe(0);
  });

  it("credits the first unlock from a single owned option", () => {
    const [firstColorId] = purchasableIdsForKind("color");
    const result = deriveStoreUnlockMaximums(new Set([firstColorId]));
    expect(result.store_color_unlocks).toBe(1);
    expect(result.store_color_collection_complete).toBe(0);
    // Buying a color must not credit the other kinds.
    expect(result.store_avatar_unlocks).toBe(0);
    expect(result.store_confetti_unlocks).toBe(0);
  });

  it("credits collection-complete once every purchasable option is owned", () => {
    const result = deriveStoreUnlockMaximums(new Set(purchasableIdsForKind("confetti")));
    expect(result.store_confetti_unlocks).toBe(1);
    expect(result.store_confetti_collection_complete).toBe(1);
  });

  it("back-fills every kind from a pre-existing owned set", () => {
    // The regression this guards: a player who already owned items got no
    // credit, because the old code only fired on the purchase that crossed the
    // threshold. Deriving from current state credits them on any next purchase.
    const owned = new Set([
      ...purchasableIdsForKind("color").slice(0, 1),
      ...purchasableIdsForKind("avatar").slice(0, 1),
      ...purchasableIdsForKind("confetti"),
    ]);
    const result = deriveStoreUnlockMaximums(owned);
    expect(result.store_color_unlocks).toBe(1);
    expect(result.store_avatar_unlocks).toBe(1);
    expect(result.store_confetti_collection_complete).toBe(1);
  });

  it("ignores default (free) options when deciding first unlock", () => {
    const defaults = STORE_CATEGORIES.flatMap((category) =>
      category.options.filter((option) => option.isDefault).map((option) => option.id),
    );
    const result = deriveStoreUnlockMaximums(new Set(defaults));
    expect(result.store_color_unlocks).toBe(0);
    expect(result.store_avatar_unlocks).toBe(0);
    expect(result.store_confetti_unlocks).toBe(0);
  });
});
