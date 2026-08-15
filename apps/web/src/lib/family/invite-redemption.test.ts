import { beforeEach, describe, expect, it, vi } from "vitest";

const adminGetDocument = vi.fn();
const adminListDocuments = vi.fn();
const adminPatchDocument = vi.fn();
const adminCreateOrReplaceDocument = vi.fn();
const adminRunQuery = vi.fn();

vi.mock("@/lib/firestore/admin", () => ({
  adminGetDocument: (...args: unknown[]) => adminGetDocument(...args),
  adminListDocuments: (...args: unknown[]) => adminListDocuments(...args),
  adminPatchDocument: (...args: unknown[]) => adminPatchDocument(...args),
  adminCreateOrReplaceDocument: (...args: unknown[]) => adminCreateOrReplaceDocument(...args),
  adminRunQuery: (...args: unknown[]) => adminRunQuery(...args),
}));

const { redeemFamilyInvite } = await import("@/lib/family/invite-redemption");
const { hashFamilyInviteCode, createFamilyInviteCode, formatFamilyInviteCode } = await import(
  "@/lib/family/invite-tokens"
);

const FAMILY_ID = "family-a";
const INVITED_EMAIL = "kid@example.com";
/** The address the child actually signs in with — Apple Hide My Email. */
const RELAY_EMAIL = "x7k2p9@privaterelay.appleid.com";
const RELAY_UID = "relay-uid";

function inviteDoc(
  code: string,
  overrides: Record<string, unknown> = {},
): { name: string; fields: Record<string, unknown> } {
  return {
    name: `projects/p/databases/(default)/documents/familyInvites/invite-1`,
    fields: {
      familyId: { stringValue: FAMILY_ID },
      familyName: { stringValue: "The Example Family" },
      memberId: { stringValue: INVITED_EMAIL },
      invitedName: { stringValue: "Sam" },
      invitedEmail: { stringValue: INVITED_EMAIL },
      role: { stringValue: "player" },
      status: { stringValue: "pending" },
      codeHash: { stringValue: hashFamilyInviteCode(code) },
      createdByUid: { stringValue: "parent-uid" },
      createdAt: { timestampValue: "2026-08-01T00:00:00.000Z" },
      expiresAt: { timestampValue: "2099-01-01T00:00:00.000Z" },
      acceptedAt: { stringValue: "" },
      acceptedByUid: { stringValue: "" },
      acceptedByEmail: { stringValue: "" },
      attemptCount: { integerValue: "0" },
      ...overrides,
    },
  };
}

function notFound() {
  return Object.assign(new Error("FIRESTORE_ADMIN_HTTP_404 document not found"), {});
}

function writesTo(pathFragment: string) {
  return adminCreateOrReplaceDocument.mock.calls.find(([path]) =>
    String(path).includes(pathFragment),
  );
}

describe("redeemFamilyInvite", () => {
  let code: string;

  beforeEach(() => {
    vi.clearAllMocks();
    code = createFamilyInviteCode();
    adminRunQuery.mockResolvedValue([inviteDoc(code)]);
    // No prior user record and no prior member doc: a brand new sign-in.
    adminGetDocument.mockRejectedValue(notFound());
    adminListDocuments.mockResolvedValue([]);
    adminPatchDocument.mockResolvedValue(undefined);
    adminCreateOrReplaceDocument.mockResolvedValue(undefined);
  });

  // This is the case the whole email-keying pass exists to fix.
  it("lets a user invited at one address join with a completely different one", async () => {
    const result = await redeemFamilyInvite({
      code,
      uid: RELAY_UID,
      email: RELAY_EMAIL,
      displayName: "Sam",
    });

    expect(result).toMatchObject({
      ok: true,
      familyId: FAMILY_ID,
      familyName: "The Example Family",
      role: "player",
      memberId: RELAY_UID,
    });

    // Membership is created uid-keyed, never keyed on either address.
    const memberWrite = writesTo(`families/${FAMILY_ID}/members/${RELAY_UID}`);
    expect(memberWrite).toBeDefined();
    const memberFields = memberWrite?.[1] as Record<string, { stringValue?: string }>;
    expect(memberFields.uid.stringValue).toBe(RELAY_UID);
    expect(memberFields.status.stringValue).toBe("active");
    expect(memberFields.role.stringValue).toBe("player");
    // The family still knows them by the address the parent typed and the name
    // the parent gave, not by the relay address.
    expect(memberFields.email.stringValue).toBe(INVITED_EMAIL);
    expect(memberFields.name.stringValue).toBe("Sam");
    // The relay address survives only as a contact detail.
    expect(memberFields.contactEmail.stringValue).toBe(RELAY_EMAIL);
  });

  it("works the same for a second Google account with an unrelated address", async () => {
    const result = await redeemFamilyInvite({
      code,
      uid: "second-google-uid",
      email: "sam.personal@gmail.com",
      displayName: "Sam",
    });
    expect(result).toMatchObject({ ok: true, familyId: FAMILY_ID });
  });

  it("never writes an email-keyed member document or invite lookup", async () => {
    await redeemFamilyInvite({ code, uid: RELAY_UID, email: RELAY_EMAIL, displayName: "Sam" });

    const createdPaths = adminCreateOrReplaceDocument.mock.calls.map(([path]) => String(path));
    const patchedPaths = adminPatchDocument.mock.calls.map(([path]) => String(path));
    const allPaths = [...createdPaths, ...patchedPaths];

    // No inviteLookup index, and the relay address is never a document key.
    expect(allPaths.some((path) => path.startsWith("inviteLookup/"))).toBe(false);
    expect(allPaths.some((path) => path.includes(RELAY_EMAIL))).toBe(false);

    // The only member document created is uid-keyed. The email-keyed one is
    // only ever touched to retire it, never created.
    const createdMemberPaths = createdPaths.filter((path) => path.includes("/members/"));
    expect(createdMemberPaths).toEqual([`families/${FAMILY_ID}/members/${RELAY_UID}`]);
  });

  it("links the user record to the family", async () => {
    await redeemFamilyInvite({ code, uid: RELAY_UID, email: RELAY_EMAIL, displayName: "Sam" });
    const userWrite = adminPatchDocument.mock.calls.find(
      ([path]) => String(path) === `users/${RELAY_UID}`,
    );
    expect(userWrite).toBeDefined();
    expect((userWrite?.[1] as Record<string, unknown>).familyIds).toEqual({
      arrayValue: { values: [{ stringValue: FAMILY_ID }] },
    });
  });

  it("retires the email-keyed placeholder the invite was issued against", async () => {
    await redeemFamilyInvite({ code, uid: RELAY_UID, email: RELAY_EMAIL, displayName: "Sam" });
    const placeholderWrite = adminPatchDocument.mock.calls.find(
      ([path]) => String(path) === `families/${FAMILY_ID}/members/${INVITED_EMAIL}`,
    );
    expect(placeholderWrite).toBeDefined();
    expect((placeholderWrite?.[1] as Record<string, unknown>).deleted).toEqual({
      booleanValue: true,
    });
  });

  it("marks the invite accepted so it cannot be reused", async () => {
    await redeemFamilyInvite({ code, uid: RELAY_UID, email: RELAY_EMAIL, displayName: "Sam" });
    const inviteWrite = adminPatchDocument.mock.calls.find(([path]) =>
      String(path).startsWith("familyInvites/"),
    );
    expect((inviteWrite?.[1] as Record<string, { stringValue?: string }>).status.stringValue).toBe(
      "accepted",
    );
  });

  it("accepts the code as the user typed it", async () => {
    const result = await redeemFamilyInvite({
      code: `  ${formatFamilyInviteCode(code).toLowerCase()} `,
      uid: RELAY_UID,
      email: RELAY_EMAIL,
      displayName: "Sam",
    });
    expect(result.ok).toBe(true);
  });

  describe("rejections", () => {
    it("rejects a malformed code without querying Firestore", async () => {
      const result = await redeemFamilyInvite({
        code: "nope",
        uid: RELAY_UID,
        email: RELAY_EMAIL,
        displayName: "Sam",
      });
      expect(result).toEqual({ ok: false, reason: "invalid_code" });
      expect(adminRunQuery).not.toHaveBeenCalled();
    });

    it("rejects an unknown code", async () => {
      adminRunQuery.mockResolvedValue([]);
      const result = await redeemFamilyInvite({
        code: createFamilyInviteCode(),
        uid: RELAY_UID,
        email: RELAY_EMAIL,
        displayName: "Sam",
      });
      expect(result).toEqual({ ok: false, reason: "invite_not_found" });
      expect(adminCreateOrReplaceDocument).not.toHaveBeenCalled();
    });

    it("rejects a code whose stored hash does not actually match", async () => {
      // Guards the query-then-verify contract: even if the index returned a
      // row, the constant-time hash check must reject it.
      adminRunQuery.mockResolvedValue([
        inviteDoc(code, { codeHash: { stringValue: hashFamilyInviteCode(createFamilyInviteCode()) } }),
      ]);
      const result = await redeemFamilyInvite({
        code,
        uid: RELAY_UID,
        email: RELAY_EMAIL,
        displayName: "Sam",
      });
      expect(result).toEqual({ ok: false, reason: "invite_not_found" });
    });

    it("rejects an already-redeemed code and records the attempt", async () => {
      adminRunQuery.mockResolvedValue([inviteDoc(code, { status: { stringValue: "accepted" } })]);
      const result = await redeemFamilyInvite({
        code,
        uid: RELAY_UID,
        email: RELAY_EMAIL,
        displayName: "Sam",
      });
      expect(result).toEqual({ ok: false, reason: "invite_already_used" });
      expect(
        adminPatchDocument.mock.calls.some(([, fields]) =>
          Object.keys(fields as object).includes("attemptCount"),
        ),
      ).toBe(true);
    });

    it("rejects an expired code", async () => {
      adminRunQuery.mockResolvedValue([
        inviteDoc(code, { expiresAt: { timestampValue: "2020-01-01T00:00:00.000Z" } }),
      ]);
      const result = await redeemFamilyInvite({
        code,
        uid: RELAY_UID,
        email: RELAY_EMAIL,
        displayName: "Sam",
      });
      expect(result).toEqual({ ok: false, reason: "invite_expired" });
    });

    it("refuses to move a user who already belongs to another family", async () => {
      adminGetDocument.mockImplementation(async (path: string) => {
        if (path === `users/${RELAY_UID}`) {
          return {
            name: `users/${RELAY_UID}`,
            fields: { familyIds: { arrayValue: { values: [{ stringValue: "other-family" }] } } },
          };
        }
        throw notFound();
      });
      const result = await redeemFamilyInvite({
        code,
        uid: RELAY_UID,
        email: RELAY_EMAIL,
        displayName: "Sam",
      });
      expect(result).toEqual({ ok: false, reason: "already_in_another_family" });
      expect(writesTo("/members/")).toBeUndefined();
    });

    it("is idempotent when the same user re-redeems into the family they are already in", async () => {
      adminGetDocument.mockImplementation(async (path: string) => {
        if (path === `users/${RELAY_UID}`) {
          return {
            name: `users/${RELAY_UID}`,
            fields: { familyIds: { arrayValue: { values: [{ stringValue: FAMILY_ID }] } } },
          };
        }
        if (path === `families/${FAMILY_ID}/members/${RELAY_UID}`) {
          return {
            name: path,
            fields: {
              status: { stringValue: "active" },
              deleted: { booleanValue: false },
              createdAt: { timestampValue: "2026-08-02T00:00:00.000Z" },
            },
          };
        }
        throw notFound();
      });
      const result = await redeemFamilyInvite({
        code,
        uid: RELAY_UID,
        email: RELAY_EMAIL,
        displayName: "Sam",
      });
      expect(result).toMatchObject({ ok: true, alreadyMember: true, familyId: FAMILY_ID });
    });
  });
});
