import { describe, expect, it } from "vitest";
import { buildFamilyMemberAliasMap, normalizeFamilyMemberAlias } from "./member-aliases";

describe("family member aliases", () => {
  const member = {
    id: "member-doc-id",
    uid: "Firebase-UID",
    email: "Kid@Example.com",
    name: "Taylor Example",
  };

  it("resolves a member by document id or uid, case-insensitively", () => {
    const membersByAlias = buildFamilyMemberAliasMap([member]);

    expect(membersByAlias.get(normalizeFamilyMemberAlias("member-doc-id"))).toBe(member);
    expect(membersByAlias.get(normalizeFamilyMemberAlias("firebase-uid"))).toBe(member);
  });

  // The email alias was the last compatibility shim for email-keyed identity.
  // With it gone, an address resolves to nobody — so a stale email-valued
  // assigneeId shows as unassigned rather than silently naming a person.
  it("no longer resolves a member by their email address", () => {
    const membersByAlias = buildFamilyMemberAliasMap([member]);

    expect(membersByAlias.get(normalizeFamilyMemberAlias(" KID@example.COM "))).toBeUndefined();
  });

  it("does not add empty aliases", () => {
    const membersByAlias = buildFamilyMemberAliasMap([{ id: "member-doc-id" }]);

    expect(membersByAlias.has("")).toBe(false);
  });
});
