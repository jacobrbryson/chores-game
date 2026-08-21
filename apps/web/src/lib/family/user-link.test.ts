import { beforeEach, describe, expect, it, vi } from "vitest";
import { linkUserPrimaryFamily } from "./user-link";
import { getDocument, patchDocument } from "@/lib/firestore/rest";

vi.mock("@/lib/firestore/rest", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/firestore/rest")>();
  return {
    ...original,
    getDocument: vi.fn(),
    patchDocument: vi.fn().mockResolvedValue({}),
  };
});

const session = {
  email: "parent@example.com",
  name: "Parent Person",
  picture: "https://example.com/p.png",
  locale: "en-US" as const,
  provider: "google" as const,
};

describe("linkUserPrimaryFamily", () => {
  beforeEach(() => vi.clearAllMocks());

  it("patches only the family fields when the user document exists", async () => {
    vi.mocked(getDocument).mockResolvedValueOnce({ name: "users/uid-1", fields: {} });
    await linkUserPrimaryFamily({
      uid: "uid-1",
      familyId: "family-1",
      role: "admin",
      session,
      idToken: "token",
    });
    const [, fields, , mask] = vi.mocked(patchDocument).mock.calls[0];
    expect(Object.keys(fields).sort()).toEqual(["familyIds", "lastFamilyUpdateAt", "uid"]);
    expect(mask).toEqual(["familyIds", "lastFamilyUpdateAt", "uid"]);
  });

  it("writes the full rules-valid shape when the user document is missing", async () => {
    // isValidSelfUserCreate rejects a partial create, so every auth-sync field
    // has to be present or the join 403s.
    vi.mocked(getDocument).mockRejectedValueOnce(new Error("FIRESTORE_HTTP_404"));
    await linkUserPrimaryFamily({
      uid: "uid-2",
      familyId: "family-2",
      role: "admin",
      session,
      idToken: "token",
    });
    const [path, fields] = vi.mocked(patchDocument).mock.calls[0];
    expect(path).toBe("users/uid-2");
    expect(Object.keys(fields).sort()).toEqual([
      "displayName",
      "email",
      "familyIds",
      "lastFamilyUpdateAt",
      "lastSignInAt",
      "locale",
      "photoUrl",
      "provider",
      "role",
      "uid",
    ]);
    // The rules compare this against the member document's role.
    expect(fields.role).toEqual({ stringValue: "admin" });
    expect(fields.provider).toEqual({ stringValue: "google" });
  });

  it("propagates non-404 read failures instead of creating a duplicate", async () => {
    vi.mocked(getDocument).mockRejectedValueOnce(new Error("FIRESTORE_HTTP_403"));
    await expect(
      linkUserPrimaryFamily({
        uid: "uid-3",
        familyId: "family-3",
        role: "player",
        session,
        idToken: "token",
      }),
    ).rejects.toThrow("FIRESTORE_HTTP_403");
    expect(vi.mocked(patchDocument)).not.toHaveBeenCalled();
  });
});
