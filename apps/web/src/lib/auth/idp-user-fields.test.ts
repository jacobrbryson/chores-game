import { describe, expect, it } from "vitest";
import { buildGoogleUserAuthFields } from "./google-user-fields";
import { buildIdpUserAuthFields } from "./idp-user-fields";

describe("Google shared auth-field regression", () => {
  it("produces the exact pre-extraction Google field payload", () => {
    const input = {
      uid: "user-1", role: "admin" as const, locale: "en-US", email: "parent@example.com",
      displayName: "Parent", photoUrl: "https://example.com/photo.png", familyId: "family-1",
      now: "2026-08-13T12:00:00.000Z",
    };
    expect(buildIdpUserAuthFields({ ...input, provider: "google" })).toEqual(
      buildGoogleUserAuthFields(input),
    );
  });
});
