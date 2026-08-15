import { describe, expect, it } from "vitest";
import {
  contactEmail,
  familyVisibleEmail,
  isPrivateRelayEmail,
  keyableEmail,
  normalizeEmail,
} from "@/lib/auth/private-relay";

describe("private relay detection", () => {
  it("recognizes Apple private-relay addresses", () => {
    expect(isPrivateRelayEmail("x7k2p9@privaterelay.appleid.com")).toBe(true);
    expect(isPrivateRelayEmail("  X7K2P9@PrivateRelay.AppleID.com  ")).toBe(true);
  });

  it("does not treat ordinary addresses as relays", () => {
    expect(isPrivateRelayEmail("kid@example.com")).toBe(false);
    expect(isPrivateRelayEmail("parent@icloud.com")).toBe(false);
    expect(isPrivateRelayEmail("me@apple.com")).toBe(false);
  });

  it("does not match a lookalike domain suffix", () => {
    // An attacker-controlled domain that merely ends with the relay string
    // must not be mistaken for Apple's relay, nor vice versa.
    expect(isPrivateRelayEmail("me@notprivaterelay.appleid.com")).toBe(false);
    expect(isPrivateRelayEmail("me@privaterelay.appleid.com.evil.test")).toBe(false);
  });

  it("handles malformed input safely", () => {
    expect(isPrivateRelayEmail("")).toBe(false);
    expect(isPrivateRelayEmail(undefined)).toBe(false);
    expect(isPrivateRelayEmail("@privaterelay.appleid.com")).toBe(false);
    expect(isPrivateRelayEmail("no-at-sign")).toBe(false);
  });

  it("refuses to produce a document key for a relay address", () => {
    expect(keyableEmail("x7k2p9@privaterelay.appleid.com")).toBe("");
    expect(keyableEmail("Kid@Example.com")).toBe("kid@example.com");
  });

  it("hides relay addresses from family-visible identity", () => {
    expect(familyVisibleEmail("x7k2p9@privaterelay.appleid.com")).toBe("");
    expect(familyVisibleEmail("kid@example.com")).toBe("kid@example.com");
  });

  it("keeps relay addresses usable for transactional mail", () => {
    expect(contactEmail("X7K2P9@privaterelay.appleid.com")).toBe(
      "x7k2p9@privaterelay.appleid.com",
    );
  });

  it("normalizes case and whitespace", () => {
    expect(normalizeEmail("  Kid@Example.COM ")).toBe("kid@example.com");
    expect(normalizeEmail(undefined)).toBe("");
  });
});
