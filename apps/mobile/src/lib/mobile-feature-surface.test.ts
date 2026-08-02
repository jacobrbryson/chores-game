import { describe, expect, it } from "vitest";
import { mainNavigationItems } from "../../../../packages/core/src/main-navigation";
import { filterActiveMobileStoreCategories } from "./mobile-feature-surface";

describe("retired quest feature on mobile", () => {
  it("does not expose a quest destination in main navigation", () => {
    expect(mainNavigationItems.map((item) => item.id)).toEqual([
      "dashboard",
      "store",
      "achievements",
      "more",
    ]);
    expect(mainNavigationItems.some((item) => item.label.toLowerCase().includes("quest"))).toBe(false);
  });

  it("removes quest categories and quest-locked options from the mobile store", () => {
    const categories = filterActiveMobileStoreCategories([
      { id: "family_awards", options: [{ unlockSource: "purchase" }] },
      { id: "quest_items", options: [{ unlockSource: "purchase" }] },
      { id: "customize_avatar", options: [{ unlockSource: "quest" }, { unlockSource: "purchase" }] },
    ]);

    expect(categories.map((category) => category.id)).toEqual(["family_awards", "customize_avatar"]);
    expect(categories[1]?.options).toEqual([{ unlockSource: "purchase" }]);
  });
});
