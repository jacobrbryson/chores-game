import { describe, expect, it } from "vitest";
import { buildGoogleUserAuthFields } from "./google-user-fields";

describe("buildGoogleUserAuthFields", () => {
  it("matches the Firestore self-create allowlist for a family-linked user", () => {
    const fields = buildGoogleUserAuthFields({
      uid: "user-1",
      role: "admin",
      locale: "en-US",
      email: "parent@example.com",
      displayName: "Parent",
      photoUrl: "https://example.com/avatar.png",
      familyId: "family-1",
      now: "2026-08-01T12:00:00.000Z",
    });

    expect(Object.keys(fields).sort()).toEqual(
      [
        "uid",
        "role",
        "locale",
        "email",
        "displayName",
        "photoUrl",
        "provider",
        "lastSignInAt",
        "familyIds",
        "lastFamilyUpdateAt",
      ].sort(),
    );
    expect(fields).not.toHaveProperty("createdAt");
  });

  it("omits family fields when no family is linked", () => {
    const fields = buildGoogleUserAuthFields({
      uid: "user-1",
      role: "player",
      locale: "en-US",
      email: "player@example.com",
      displayName: "Player",
      photoUrl: "",
      now: "2026-08-01T12:00:00.000Z",
    });

    expect(fields).not.toHaveProperty("familyIds");
    expect(fields).not.toHaveProperty("lastFamilyUpdateAt");
  });
});
