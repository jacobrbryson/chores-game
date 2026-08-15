/**
 * Maps a member's identifiers to the member, so UI code can resolve whatever a
 * chore's `assigneeId` happens to hold.
 *
 * The `email` alias was removed with the email-keying migration. It was the
 * compatibility shim that let the rest of the app paper over two keying schemes
 * while `members/{email}` documents and email-valued `assigneeId`s still
 * existed; once those were migrated it stopped being a convenience and became a
 * way for an address to resolve to a person. Identity is `id`/`uid` only.
 */
type FamilyMemberAliasFields = {
  id: string;
  uid?: string;
};

export function normalizeFamilyMemberAlias(value?: string) {
  return (value ?? "").trim().toLowerCase();
}

export function buildFamilyMemberAliasMap<T extends FamilyMemberAliasFields>(members: T[]) {
  const membersByAlias = new Map<string, T>();

  for (const member of members) {
    for (const alias of [member.id, member.uid]) {
      const normalizedAlias = normalizeFamilyMemberAlias(alias);
      if (normalizedAlias) {
        membersByAlias.set(normalizedAlias, member);
      }
    }
  }

  return membersByAlias;
}
