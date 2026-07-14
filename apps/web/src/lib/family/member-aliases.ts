type FamilyMemberAliasFields = {
  id: string;
  uid?: string;
  email?: string;
};

export function normalizeFamilyMemberAlias(value?: string) {
  return (value ?? "").trim().toLowerCase();
}

export function buildFamilyMemberAliasMap<T extends FamilyMemberAliasFields>(members: T[]) {
  const membersByAlias = new Map<string, T>();

  for (const member of members) {
    for (const alias of [member.id, member.uid, member.email]) {
      const normalizedAlias = normalizeFamilyMemberAlias(alias);
      if (normalizedAlias) {
        membersByAlias.set(normalizedAlias, member);
      }
    }
  }

  return membersByAlias;
}
