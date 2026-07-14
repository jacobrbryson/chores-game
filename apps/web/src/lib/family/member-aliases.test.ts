import { describe, expect, it } from "vitest";
import { buildFamilyMemberAliasMap, normalizeFamilyMemberAlias } from "./member-aliases";

describe("family member aliases", () => {
  const member = {
    id: "member-doc-id",
    uid: "Firebase-UID",
    email: "Kid@Example.com",
    name: "Taylor Example",
  };

  it("resolves a member by document id, uid, or normalized email", () => {
    const membersByAlias = buildFamilyMemberAliasMap([member]);

    expect(membersByAlias.get(normalizeFamilyMemberAlias("member-doc-id"))).toBe(member);
    expect(membersByAlias.get(normalizeFamilyMemberAlias("firebase-uid"))).toBe(member);
    expect(membersByAlias.get(normalizeFamilyMemberAlias(" KID@example.COM "))).toBe(member);
  });

  it("does not add empty aliases", () => {
    const membersByAlias = buildFamilyMemberAliasMap([{ id: "member-doc-id" }]);

    expect(membersByAlias.has("")).toBe(false);
  });
});
