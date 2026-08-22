import { describe, expect, it } from "vitest";

import { orcwoodProviderLinkId } from "@/lib/auth/orcwood-provider-link";

// This id format is a cross-service contract with `providerLinkId` in
// orcwood-api/src/lib/accounts/store.ts. If the two ever disagree, Family
// Chores writes links orcwood-api cannot find and every user who signs up here
// first gets a second account over there — silently. These cases mirror the
// ones in that repo's store.test.ts on purpose.
describe("orcwoodProviderLinkId", () => {
  it("matches the format orcwood-api derives", () => {
    expect(orcwoodProviderLinkId("google", "110358")).toBe("google__110358");
    expect(orcwoodProviderLinkId("apple", "000814.abc")).toBe("apple__000814.abc");
  });

  it("namespaces by provider so two providers cannot collide on one subject", () => {
    expect(orcwoodProviderLinkId("google", "123")).not.toBe(orcwoodProviderLinkId("apple", "123"));
  });

  it("encodes a subject that would otherwise break a document path", () => {
    expect(orcwoodProviderLinkId("google", "a/b")).not.toContain("/");
  });
});
