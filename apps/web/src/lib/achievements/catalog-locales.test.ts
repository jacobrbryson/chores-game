import { describe, expect, it } from "vitest";
import { ACHIEVEMENT_CATALOG } from "@/lib/achievements/catalog";
import { getAchievementCatalogCopy } from "@/lib/achievements/catalog-locales";

describe("achievement catalog locales", () => {
  it("provides localized copy for every achievement in fr-FR and es-US", () => {
    for (const locale of ["fr-FR", "es-US"] as const) {
      for (const entry of ACHIEVEMENT_CATALOG) {
        const copy = getAchievementCatalogCopy(entry.id, locale, {
          title: "",
          wittyTitle: "",
          description: "",
        });
        expect(copy.title).not.toBe("");
        expect(copy.wittyTitle).not.toBe("");
        expect(copy.description).not.toBe("");
      }
    }
  });
});
