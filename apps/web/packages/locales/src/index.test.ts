import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  createTranslator,
  normalizeLocale,
  resolveLocalePreference,
} from "./index";

describe("locales", () => {
  it("exposes the supported locales in the required order", () => {
    expect(SUPPORTED_LOCALES).toEqual(["fr-FR", "en-US", "es-US"]);
  });

  it("normalizes supported locales", () => {
    expect(normalizeLocale("fr-FR")).toBe("fr-FR");
    expect(normalizeLocale("en-US")).toBe("en-US");
    expect(normalizeLocale("es-US")).toBe("es-US");
    expect(normalizeLocale("pt-BR")).toBeNull();
  });

  it("resolves locale with family and default fallback", () => {
    expect(
      resolveLocalePreference({
        requestedLocale: "",
        familyLocale: "es-US",
      }),
    ).toBe("es-US");
    expect(
      resolveLocalePreference({
        requestedLocale: "",
        familyLocale: "",
      }),
    ).toBe(DEFAULT_LOCALE);
  });

  it("falls back to default messages and interpolates values", () => {
    const onMissingKey = vi.fn();
    const t = createTranslator({
      locale: "fr-FR",
      onMissingKey,
    });

    expect(t("quests.endingsDiscovered", { found: 1, total: 6 })).toBe("Fins decouvertes : 1/6");
    expect(t("profile.languageSaved")).toBe("Langue mise à jour.");
    expect(onMissingKey).not.toHaveBeenCalled();
  });
});
