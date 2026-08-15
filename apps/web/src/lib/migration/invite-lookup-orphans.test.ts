import { describe, expect, it } from "vitest";
import {
  classifyInviteLookup,
  type FamilyExistence,
  type InviteLookupRow,
} from "@/lib/migration/invite-lookup-orphans";
import type { MemberRecord } from "@/lib/migration/email-keying-types";

const FAMILY = "famA";

function families(overrides: Partial<FamilyExistence> = {}) {
  return new Map<string, FamilyExistence>([
    [FAMILY, { familyId: FAMILY, exists: true, deleted: false, ...overrides }],
  ]);
}

function member(overrides: Partial<MemberRecord> & Pick<MemberRecord, "memberId">) {
  return {
    familyId: FAMILY,
    email: "",
    uid: "",
    name: "Member",
    status: "active",
    role: "player",
    deleted: false,
    createdAt: "",
    ...overrides,
  } satisfies MemberRecord;
}

function members(list: MemberRecord[]) {
  return new Map<string, MemberRecord[]>([[FAMILY, list]]);
}

const row: InviteLookupRow = {
  docId: "kid@example.com",
  email: "kid@example.com",
  familyId: FAMILY,
  status: "invited",
};

describe("classifyInviteLookup", () => {
  it("is an orphan when the person accepted and the email-keyed doc is gone", () => {
    const verdict = classifyInviteLookup(
      row,
      families(),
      members([member({ memberId: "kid-uid", uid: "kid-uid", email: "kid@example.com" })]),
    );
    expect(verdict).toEqual({
      docId: "kid@example.com",
      orphan: true,
      familyId: FAMILY,
      acceptedMemberId: "kid-uid",
    });
  });

  it("is NOT an orphan while the email-keyed member doc still exists", () => {
    const verdict = classifyInviteLookup(
      row,
      families(),
      members([
        member({ memberId: "kid@example.com", email: "kid@example.com", status: "invited" }),
      ]),
    );
    expect(verdict).toMatchObject({ orphan: false, reason: "email_member_doc_still_exists" });
  });

  it("is NOT an orphan when nobody has accepted", () => {
    const verdict = classifyInviteLookup(row, families(), members([]));
    expect(verdict).toMatchObject({ orphan: false, reason: "no_accepted_member" });
  });

  it("is NOT an orphan when the accepted member doc is soft-deleted", () => {
    const verdict = classifyInviteLookup(
      row,
      families(),
      members([
        member({ memberId: "kid-uid", uid: "kid-uid", email: "kid@example.com", deleted: true }),
      ]),
    );
    expect(verdict).toMatchObject({ orphan: false, reason: "no_accepted_member" });
  });

  it("is NOT an orphan when the counterpart is only invited or claimed", () => {
    for (const status of ["invited", "claimed"]) {
      const verdict = classifyInviteLookup(
        row,
        families(),
        members([member({ memberId: "kid-uid", uid: "kid-uid", email: "kid@example.com", status })]),
      );
      expect(verdict).toMatchObject({ orphan: false, reason: "no_accepted_member" });
    }
  });

  it("leaves lookups pointing at a missing family alone", () => {
    const verdict = classifyInviteLookup(
      row,
      new Map(),
      members([member({ memberId: "kid-uid", uid: "kid-uid", email: "kid@example.com" })]),
    );
    expect(verdict).toMatchObject({ orphan: false, reason: "family_missing" });
  });

  it("leaves lookups pointing at a soft-deleted family alone", () => {
    const verdict = classifyInviteLookup(
      row,
      families({ deleted: true }),
      members([member({ memberId: "kid-uid", uid: "kid-uid", email: "kid@example.com" })]),
    );
    expect(verdict).toMatchObject({ orphan: false, reason: "family_deleted" });
  });

  it("does not match an accepted member from a different family", () => {
    const verdict = classifyInviteLookup(
      row,
      families(),
      new Map<string, MemberRecord[]>([
        [
          "famB",
          [member({ familyId: "famB", memberId: "kid-uid", email: "kid@example.com" })],
        ],
      ]),
    );
    expect(verdict).toMatchObject({ orphan: false, reason: "no_accepted_member" });
  });

  it("matches case-insensitively on both the key and the stored email", () => {
    const verdict = classifyInviteLookup(
      { ...row, docId: "KID@Example.com" },
      families(),
      members([member({ memberId: "kid-uid", uid: "kid-uid", email: "Kid@EXAMPLE.com" })]),
    );
    expect(verdict).toMatchObject({ orphan: true, acceptedMemberId: "kid-uid" });
  });

  it("skips a lookup with no familyId rather than guessing", () => {
    const verdict = classifyInviteLookup({ ...row, familyId: "" }, families(), members([]));
    expect(verdict).toMatchObject({ orphan: false, reason: "no_family_id" });
  });
});
