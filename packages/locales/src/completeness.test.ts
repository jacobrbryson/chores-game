import { describe, expect, it } from "vitest";
import enUS from "./en-US.json";
import esUS from "./es-US.json";
import frFR from "./fr-FR.json";

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }

  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, nested]) => flattenKeys(nested, prefix ? `${prefix}.${key}` : key))
    .sort();
}

describe("locale file completeness", () => {
  it("keeps fr-FR and es-US synchronized with en-US keys", () => {
    const baselineKeys = flattenKeys(enUS);

    expect(flattenKeys(frFR)).toEqual(baselineKeys);
    expect(flattenKeys(esUS)).toEqual(baselineKeys);
  });
});
