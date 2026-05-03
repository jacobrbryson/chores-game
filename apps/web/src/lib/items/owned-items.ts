import { findGameItemById } from "@/lib/items/catalog";
import { findStoreOptionById } from "@/lib/store/catalog";

export type OwnedItemSummary = {
  id: string;
  name: string;
  description: string;
  image: string;
  category: string;
  quantity: number;
  source: "inventory" | "store_unlock";
  addedAt?: string;
  paidValue: number;
  acquisitionLabel: string;
};

export function buildOwnedItemsSummary(input: {
  ownedOptionIds: Iterable<string>;
  inventoryByItemId: Map<string, { quantity: number; addedAt?: string }>;
  paidValueByItemId?: Map<string, number>;
  acquisitionLabelByItemId?: Map<string, string>;
}) {
  const byId = new Map<string, OwnedItemSummary>();

  for (const [itemId, entry] of input.inventoryByItemId) {
    const gameItem = findGameItemById(itemId);
    byId.set(itemId, {
      id: itemId,
      name: gameItem?.name || itemId,
      description: gameItem?.description || "Inventory item",
      image: gameItem?.image || "/assets/items/placeholder.png",
      category: gameItem?.category || "inventory",
      quantity: Math.max(0, entry.quantity),
      source: "inventory",
      addedAt: entry.addedAt,
      paidValue: Math.max(0, input.paidValueByItemId?.get(itemId) ?? 0),
      acquisitionLabel:
        input.acquisitionLabelByItemId?.get(itemId) ??
        `${gameItem?.name || itemId} reward`,
    });
  }

  for (const optionId of input.ownedOptionIds) {
    if (!optionId) {
      continue;
    }
    if (byId.has(optionId)) {
      continue;
    }
    const optionMatch = findStoreOptionById(optionId);
    if (!optionMatch) {
      continue;
    }
    byId.set(optionId, {
      id: optionId,
      name: optionMatch.option.label,
      description: optionMatch.category.description,
      image:
        optionMatch.option.itemImage ||
        (optionMatch.category.kind === "avatar" ? `/avatars/default/${optionMatch.option.value}` : optionMatch.category.imagePath),
      category: optionMatch.category.id,
      quantity: 1,
      source: "store_unlock",
      paidValue: Math.max(0, input.paidValueByItemId?.get(optionId) ?? 0),
      acquisitionLabel:
        input.acquisitionLabelByItemId?.get(optionId) ?? "Store purchase",
    });
  }

  function toUnixMillis(value?: string) {
    if (!value) {
      return 0;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return Array.from(byId.values()).sort((left, right) => {
    const byAddedAt = toUnixMillis(right.addedAt) - toUnixMillis(left.addedAt);
    if (byAddedAt !== 0) {
      return byAddedAt;
    }
    if (right.quantity !== left.quantity) {
      return right.quantity - left.quantity;
    }
    return left.name.localeCompare(right.name);
  });
}
