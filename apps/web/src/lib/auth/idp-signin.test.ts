import { beforeEach, describe, expect, it, vi } from "vitest";
import { signInWithFirebaseIdp, upsertIdpUser } from "./idp-signin";
import {
  findFirstFamilyIdByMemberUid,
  getDocument,
  patchDocument,
} from "@/lib/firestore/rest";

// Family resolution is uid-keyed since the email-keying migration:
// findFirstFamilyIdByMemberEmail and the inviteLookup/{email} read are gone.
vi.mock("@/lib/firestore/rest", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/firestore/rest")>();
  return {
    ...original,
    getDocument: vi.fn(),
    listDocuments: vi.fn().mockResolvedValue([]),
    findFirstFamilyIdByMemberUid: vi.fn().mockResolvedValue(""),
    patchDocument: vi.fn().mockResolvedValue({}),
  };
});

const session = {
  localId: "firebase-uid",
  idToken: "firebase-id-token",
  refreshToken: "firebase-refresh-token",
  email: "relay@privaterelay.appleid.com",
};

describe("upsertIdpUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists Apple's first-authorization name", async () => {
    vi.mocked(getDocument).mockRejectedValue(new Error("FIRESTORE_HTTP_404"));
    // A family has to resolve for the user document to be written at all; the
    // family-less case is deferred and covered separately below.
    vi.mocked(findFirstFamilyIdByMemberUid).mockResolvedValueOnce("family-from-uid");
    const result = await upsertIdpUser({
      session,
      identity: { subject: "apple-sub", name: "Taylor Apple" },
      provider: "apple",
    });
    expect(result.displayName).toBe("Taylor Apple");
    expect(vi.mocked(patchDocument).mock.calls[0][1].displayName).toEqual({ stringValue: "Taylor Apple" });
  });

  it("defers the user document for a first sign-in with no family", async () => {
    // Writing users/{uid} here is what left an orphan player row behind for
    // every abandoned create-or-join-a-family step.
    vi.mocked(getDocument).mockRejectedValue(new Error("FIRESTORE_HTTP_404"));
    const result = await upsertIdpUser({
      session,
      identity: { subject: "google-sub", name: "Abandoned Signup" },
      provider: "google",
    });
    expect(result.userDocDeferred).toBe(true);
    expect(vi.mocked(patchDocument)).not.toHaveBeenCalled();
  });

  it("still refreshes an existing user document that has no family", async () => {
    // Accounts orphaned before the deferral must not go stale.
    vi.mocked(getDocument).mockResolvedValueOnce({
      name: "users/firebase-uid",
      fields: { role: { stringValue: "player" }, locale: { stringValue: "en-US" } },
    });
    const result = await upsertIdpUser({
      session,
      identity: { subject: "google-sub", name: "Existing Orphan" },
      provider: "google",
    });
    expect(result.userDocDeferred).toBe(false);
    expect(vi.mocked(patchDocument)).toHaveBeenCalled();
  });

  it("does not overwrite an existing Apple name when later authorization omits it", async () => {
    vi.mocked(getDocument).mockResolvedValueOnce({
      name: "users/firebase-uid",
      fields: {
        role: { stringValue: "player" },
        locale: { stringValue: "en-US" },
        displayName: { stringValue: "Taylor Apple" },
      },
    });
    const result = await upsertIdpUser({
      session,
      identity: { subject: "apple-sub" },
      provider: "apple",
    });
    expect(result.displayName).toBe("Taylor Apple");
    expect(vi.mocked(patchDocument).mock.calls[0][1].displayName).toEqual({ stringValue: "Taylor Apple" });
  });

  it("returns an actionable setup state and never bootstraps an unmatched family", async () => {
    vi.mocked(getDocument).mockRejectedValue(new Error("FIRESTORE_HTTP_404"));
    const result = await upsertIdpUser({
      session,
      identity: { subject: "google-sub", email: "different@example.com", name: "Google User" },
      provider: "google",
    });
    expect(result.familyResolution).toBe("needs_family_setup");
    expect(result.role).toBe("player");
    // No unmatched family is bootstrapped, and with nothing to link there is no
    // user document write at all.
    expect(vi.mocked(patchDocument)).not.toHaveBeenCalled();
  });

  it("resolves family membership by uid, never by email", async () => {
    vi.mocked(getDocument).mockRejectedValue(new Error("FIRESTORE_HTTP_404"));
    vi.mocked(findFirstFamilyIdByMemberUid).mockResolvedValueOnce("family-from-uid");
    const result = await upsertIdpUser({
      session,
      identity: { subject: "apple-sub", email: "relay@privaterelay.appleid.com" },
      provider: "apple",
    });
    expect(vi.mocked(findFirstFamilyIdByMemberUid)).toHaveBeenCalledWith(
      "firebase-uid",
      "firebase-id-token",
    );
    expect(result.familyResolution).toBe("resolved");
  });

  it("does not read inviteLookup — a relay address could never key one", async () => {
    vi.mocked(getDocument).mockRejectedValue(new Error("FIRESTORE_HTTP_404"));
    await upsertIdpUser({
      session,
      identity: { subject: "apple-sub", email: "relay@privaterelay.appleid.com" },
      provider: "apple",
    });
    const readPaths = vi.mocked(getDocument).mock.calls.map((call) => call[0]);
    expect(readPaths.some((path) => path.startsWith("inviteLookup/"))).toBe(false);
  });
});

describe("signInWithFirebaseIdp Google regression", () => {
  it("keeps the existing Google Identity Toolkit request payload unchanged", async () => {
    const previousKey = process.env.FIREBASE_WEB_API_KEY;
    process.env.FIREBASE_WEB_API_KEY = "firebase-key";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      localId: "firebase-uid",
      idToken: "firebase-id-token",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await signInWithFirebaseIdp({
        idToken: "google.jwt.value",
        providerId: "google.com",
        requestUri: "https://family-chores.app",
      });
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        postBody: "id_token=google.jwt.value&providerId=google.com",
        requestUri: "https://family-chores.app",
        returnSecureToken: true,
        returnIdpCredential: false,
      });
    } finally {
      vi.unstubAllGlobals();
      if (previousKey === undefined) delete process.env.FIREBASE_WEB_API_KEY;
      else process.env.FIREBASE_WEB_API_KEY = previousKey;
    }
  });
});
