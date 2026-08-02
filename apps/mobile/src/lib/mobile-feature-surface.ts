type StoreOptionSurface = { unlockSource?: string };
type StoreCategorySurface = { id: string; options: StoreOptionSurface[] };

const RETIRED_STORE_CATEGORY_IDS = new Set(["quest_items"]);

export function filterActiveMobileStoreCategories<T extends StoreCategorySurface>(categories: readonly T[]): T[] {
  return categories
    .filter((category) => !RETIRED_STORE_CATEGORY_IDS.has(category.id))
    .map((category) => ({
      ...category,
      options: category.options.filter((option) => option.unlockSource !== "quest"),
    }));
}
