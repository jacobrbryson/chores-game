import { createHash } from "node:crypto";
import { isPrivateRelayEmail, normalizeEmail } from "@/lib/auth/private-relay";
import type {
  AssigneeRefRecord,
  EmailKeyedMemberDisposition,
  EmailKeyedMemberRow,
  EmailKeyingAudit,
  EmailKeyingSnapshot,
  FamilyAuditRow,
  MemberRecord,
} from "@/lib/migration/email-keying-types";

/**
 * Pure classification for the email-keying migration dry run.
 *
 * Nothing in here reads or writes Firestore. The runner
 * (`scripts/email-keying-dry-run.ts`) does the paginated reads and hands the
 * whole snapshot in, so the rules that decide "safe to delete" versus "must be
 * rewritten" can be pinned by unit tests before anything mutates real data.
 */

/**
 * A Firestore document id is email-keyed when it parses as an address. Document
 * ids cannot contain `/`, and every email-keyed doc this app writes is a
 * normalized address, so a single conservative shape test is enough.
 */
export function looksLikeEmail(value: string | undefined | null) {
  const trimmed = (value ?? "").trim();
  if (!trimmed || trimmed.length > 320) return false;
  return /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]{2,}$/.test(trimmed);
}

/** Stable correlation handle that survives redaction. */
export function emailHash(value: string) {
  return createHash("sha256").update(normalizeEmail(value)).digest("hex").slice(0, 12);
}

/**
 * Addresses are `CHILD_SENSITIVE`, and this report is written to a file on an
 * operator's laptop. Default to a shape-preserving redaction: enough to see
 * domain patterns and spot obvious junk, not enough to be a contact list.
 */
export function redactEmail(value: string) {
  const normalized = normalizeEmail(value);
  const atIndex = normalized.lastIndexOf("@");
  if (atIndex <= 0) return normalized ? "***" : "";
  const local = normalized.slice(0, atIndex);
  const domain = normalized.slice(atIndex + 1);
  return `${local.slice(0, 1)}***@${domain}`;
}

function present(value: string, includeRaw: boolean) {
  return includeRaw ? normalizeEmail(value) : redactEmail(value);
}

function bump(counter: Record<string, number>, key: string, by = 1) {
  counter[key] = (counter[key] ?? 0) + by;
}

function statusKey(status: string) {
  return status.trim() ? status.trim() : "(none)";
}

function isEmailKeyed(member: MemberRecord) {
  return looksLikeEmail(member.memberId);
}

type MemberIndex = {
  byFamily: Map<string, MemberRecord[]>;
  uidKeyedByFamily: Map<string, MemberRecord[]>;
};

function indexMembers(members: MemberRecord[]): MemberIndex {
  const byFamily = new Map<string, MemberRecord[]>();
  const uidKeyedByFamily = new Map<string, MemberRecord[]>();
  for (const member of members) {
    const family = byFamily.get(member.familyId) ?? [];
    family.push(member);
    byFamily.set(member.familyId, family);
    if (!isEmailKeyed(member)) {
      const uidKeyed = uidKeyedByFamily.get(member.familyId) ?? [];
      uidKeyed.push(member);
      uidKeyedByFamily.set(member.familyId, uidKeyed);
    }
  }
  return { byFamily, uidKeyedByFamily };
}

type Counterpart = {
  member: MemberRecord | null;
  knownUid: string;
  resolvedVia: EmailKeyedMemberRow["resolvedVia"];
};

/**
 * Decide whether an email-keyed member doc is a duplicate of a uid-keyed doc
 * for the same person, in three widening steps. Order matters: a direct uid
 * match is stronger evidence than an email-field match, which in turn is
 * stronger than a `users` lookup that may point at a uid with no member doc.
 */
function findCounterpart(
  emailDoc: MemberRecord,
  uidKeyedInFamily: MemberRecord[],
  usersByEmail: Map<string, string>,
): Counterpart {
  const key = normalizeEmail(emailDoc.memberId);
  const declaredUid = emailDoc.uid.trim();

  if (declaredUid) {
    const byUid = uidKeyedInFamily.find(
      (candidate) =>
        !candidate.deleted &&
        (candidate.memberId === declaredUid || candidate.uid.trim() === declaredUid),
    );
    if (byUid) {
      return { member: byUid, knownUid: declaredUid, resolvedVia: "member_uid" };
    }
  }

  const byEmail = uidKeyedInFamily.find(
    (candidate) => !candidate.deleted && normalizeEmail(candidate.email) === key,
  );
  if (byEmail) {
    return {
      member: byEmail,
      knownUid: byEmail.uid.trim() || byEmail.memberId,
      resolvedVia: "member_email",
    };
  }

  const userUid = usersByEmail.get(key) ?? "";
  if (userUid) {
    const byUserUid = uidKeyedInFamily.find(
      (candidate) =>
        !candidate.deleted &&
        (candidate.memberId === userUid || candidate.uid.trim() === userUid),
    );
    return { member: byUserUid ?? null, knownUid: userUid, resolvedVia: "user_email" };
  }

  // The email-keyed doc may name a uid that simply has no member doc yet.
  if (declaredUid) {
    return { member: null, knownUid: declaredUid, resolvedVia: "member_uid" };
  }
  return { member: null, knownUid: "", resolvedVia: "none" };
}

function dispositionFor(
  emailDoc: MemberRecord,
  counterpart: Counterpart,
): EmailKeyedMemberDisposition {
  if (emailDoc.deleted || emailDoc.status === "revoked") {
    return "revoked_or_deleted";
  }
  if (counterpart.member) {
    return "stale_orphan";
  }
  return counterpart.knownUid ? "migratable" : "pending_invite";
}

function buildEmailKeyedRows(
  snapshot: EmailKeyingSnapshot,
  index: MemberIndex,
  usersByEmail: Map<string, string>,
) {
  const rows: EmailKeyedMemberRow[] = [];
  for (const member of snapshot.members) {
    if (!isEmailKeyed(member)) continue;
    const uidKeyed = index.uidKeyedByFamily.get(member.familyId) ?? [];
    const counterpart = findCounterpart(member, uidKeyed, usersByEmail);
    const key = normalizeEmail(member.memberId);
    const storedEmail = normalizeEmail(member.email);
    rows.push({
      familyId: member.familyId,
      emailKey: present(member.memberId, snapshot.includeRawEmails),
      emailHash: emailHash(member.memberId),
      status: statusKey(member.status),
      role: member.role,
      deleted: member.deleted,
      disposition: dispositionFor(member, counterpart),
      counterpartMemberId: counterpart.member?.memberId ?? "",
      resolvedVia: counterpart.resolvedVia,
      knownUid: counterpart.knownUid,
      isPrivateRelay: isPrivateRelayEmail(member.memberId),
      emailFieldDisagrees: Boolean(storedEmail) && storedEmail !== key,
      counterpartEmailDisagrees: Boolean(
        counterpart.member &&
          normalizeEmail(counterpart.member.email) &&
          normalizeEmail(counterpart.member.email) !== key,
      ),
    });
  }
  return rows;
}

function analyzeInviteLookup(snapshot: EmailKeyingSnapshot, index: MemberIndex) {
  const familyIds = new Set(snapshot.families.map((family) => family.familyId));
  const deletedFamilyIds = new Set(
    snapshot.families.filter((family) => family.deleted).map((family) => family.familyId),
  );
  const byStatus: Record<string, number> = {};
  let familyMissing = 0;
  let familyDeleted = 0;
  let memberMissing = 0;
  let memberDeleted = 0;
  let orphanedByAcceptedMember = 0;
  let privateRelay = 0;

  for (const lookup of snapshot.inviteLookups) {
    bump(byStatus, statusKey(lookup.status));
    if (isPrivateRelayEmail(lookup.docId)) privateRelay += 1;
    if (!lookup.familyId || !familyIds.has(lookup.familyId)) {
      familyMissing += 1;
      continue;
    }
    if (deletedFamilyIds.has(lookup.familyId)) familyDeleted += 1;

    const key = normalizeEmail(lookup.docId);
    const members = index.byFamily.get(lookup.familyId) ?? [];
    const emailDoc = members.find((member) => normalizeEmail(member.memberId) === key);
    if (!emailDoc) {
      memberMissing += 1;
    } else if (emailDoc.deleted) {
      memberDeleted += 1;
    }
    const acceptedUidDoc = (index.uidKeyedByFamily.get(lookup.familyId) ?? []).find(
      (member) => !member.deleted && normalizeEmail(member.email) === key,
    );
    if (acceptedUidDoc) orphanedByAcceptedMember += 1;
  }

  return {
    total: snapshot.inviteLookups.length,
    byStatus,
    familyMissing,
    familyDeleted,
    memberMissing,
    memberDeleted,
    orphanedByAcceptedMember,
    privateRelay,
  };
}

function assigneeResolves(ref: AssigneeRefRecord, index: MemberIndex) {
  const key = normalizeEmail(ref.value);
  const members = index.byFamily.get(ref.familyId) ?? [];
  return members.some(
    (member) =>
      !member.deleted &&
      (normalizeEmail(member.memberId) === key || normalizeEmail(member.email) === key),
  );
}

function analyzeAssigneeRefs(snapshot: EmailKeyingSnapshot, index: MemberIndex) {
  const byCollection: Record<string, { total: number; resolves: number; dangles: number }> = {};
  const samples: EmailKeyingAudit["assigneeRefs"]["samples"] = [];
  let resolves = 0;
  let dangles = 0;
  let onDeletedDocs = 0;
  let onOpenChores = 0;
  let privateRelay = 0;

  for (const ref of snapshot.assigneeRefs) {
    const bucket = byCollection[ref.collectionId] ?? { total: 0, resolves: 0, dangles: 0 };
    bucket.total += 1;
    const resolved = assigneeResolves(ref, index);
    if (resolved) {
      bucket.resolves += 1;
      resolves += 1;
    } else {
      bucket.dangles += 1;
      dangles += 1;
    }
    byCollection[ref.collectionId] = bucket;

    if (ref.deleted) onDeletedDocs += 1;
    if (!ref.deleted && (ref.status === "Open" || ref.status === "Submitted")) onOpenChores += 1;
    if (isPrivateRelayEmail(ref.value)) privateRelay += 1;

    if (samples.length < 25) {
      samples.push({
        familyId: ref.familyId,
        collectionId: ref.collectionId,
        docId: ref.docId,
        fieldPath: ref.fieldPath,
        value: present(ref.value, snapshot.includeRawEmails),
        resolved,
        status: ref.status,
        deleted: ref.deleted,
      });
    }
  }

  return {
    total: snapshot.assigneeRefs.length,
    byCollection,
    resolves,
    dangles,
    onDeletedDocs,
    onOpenChores,
    privateRelay,
    samples,
  };
}

function analyzeStrandedUsers(
  snapshot: EmailKeyingSnapshot,
  index: MemberIndex,
  usersByEmail: Map<string, string>,
  usersByUid: Map<string, EmailKeyingSnapshot["users"][number]>,
) {
  const rows: EmailKeyingAudit["strandedUsers"]["rows"] = [];
  let familyIdsEmpty = 0;
  let familyIdsMissingThatFamily = 0;
  let noUserDoc = 0;

  for (const member of snapshot.members) {
    if (!isEmailKeyed(member) || member.deleted || member.status === "revoked") continue;
    const key = normalizeEmail(member.memberId);
    const uid = member.uid.trim() || usersByEmail.get(key) || "";
    const user = uid ? usersByUid.get(uid) : undefined;

    // The email-keyed doc is the only trace of this person: nobody has signed
    // in under that address yet, so there is nothing stranded — it is a
    // genuinely pending invite instead.
    if (!user) {
      const counterpart = findCounterpart(
        member,
        index.uidKeyedByFamily.get(member.familyId) ?? [],
        usersByEmail,
      );
      if (counterpart.member) continue;
      noUserDoc += 1;
      rows.push({
        familyId: member.familyId,
        emailKey: present(member.memberId, snapshot.includeRawEmails),
        emailHash: emailHash(member.memberId),
        uid,
        reason: "no_user_doc",
        memberStatus: statusKey(member.status),
      });
      continue;
    }

    if (user.familyIds.length === 0) {
      familyIdsEmpty += 1;
      rows.push({
        familyId: member.familyId,
        emailKey: present(member.memberId, snapshot.includeRawEmails),
        emailHash: emailHash(member.memberId),
        uid,
        reason: "family_ids_empty",
        memberStatus: statusKey(member.status),
      });
      continue;
    }

    if (!user.familyIds.includes(member.familyId)) {
      familyIdsMissingThatFamily += 1;
      rows.push({
        familyId: member.familyId,
        emailKey: present(member.memberId, snapshot.includeRawEmails),
        emailHash: emailHash(member.memberId),
        uid,
        reason: "family_ids_missing_family",
        memberStatus: statusKey(member.status),
      });
    }
  }

  return { familyIdsEmpty, familyIdsMissingThatFamily, noUserDoc, rows };
}

function analyzeEdgeCases(snapshot: EmailKeyingSnapshot, rows: EmailKeyedMemberRow[]) {
  const familiesByEmail = new Map<string, Set<string>>();
  const variantsByKey = new Map<string, Map<string, Set<string>>>();

  function noteVariant(raw: string, location: string) {
    const trimmed = (raw ?? "").trim();
    if (!trimmed || !looksLikeEmail(trimmed)) return;
    const key = normalizeEmail(trimmed);
    const variants = variantsByKey.get(key) ?? new Map<string, Set<string>>();
    const locations = variants.get(raw) ?? new Set<string>();
    locations.add(location);
    variants.set(raw, locations);
    variantsByKey.set(key, variants);
  }

  let membersWithNoEmailUidKeyed = 0;
  let membersWithNoEmailOtherKeyed = 0;

  for (const member of snapshot.members) {
    noteVariant(member.memberId, `members/${member.familyId}#id`);
    noteVariant(member.email, `members/${member.familyId}#email`);
    if (isEmailKeyed(member) && !member.deleted) {
      const key = normalizeEmail(member.memberId);
      const families = familiesByEmail.get(key) ?? new Set<string>();
      families.add(member.familyId);
      familiesByEmail.set(key, families);
    }
    if (!member.deleted && !normalizeEmail(member.email) && !isEmailKeyed(member)) {
      if (member.uid.trim() === member.memberId || member.uid.trim()) {
        membersWithNoEmailUidKeyed += 1;
      } else {
        membersWithNoEmailOtherKeyed += 1;
      }
    }
  }
  for (const user of snapshot.users) {
    noteVariant(user.email, "users#email");
  }
  for (const lookup of snapshot.inviteLookups) {
    noteVariant(lookup.docId, "inviteLookup#id");
    noteVariant(lookup.email, "inviteLookup#email");
  }
  for (const ref of snapshot.assigneeRefs) {
    noteVariant(ref.value, `${ref.collectionId}#${ref.fieldPath}`);
  }

  const multiFamily = [...familiesByEmail.entries()]
    .filter(([, families]) => families.size > 1)
    .map(([key, families]) => ({
      emailKey: present(key, snapshot.includeRawEmails),
      emailHash: emailHash(key),
      familyIds: [...families].sort(),
    }));

  const caseVariants = [...variantsByKey.entries()]
    .filter(([, variants]) => variants.size > 1)
    .map(([key, variants]) => ({
      emailHash: emailHash(key),
      variants: snapshot.includeRawEmails
        ? [...variants.keys()].sort()
        : [...variants.keys()].map((variant) => redactEmail(variant)).sort(),
      locations: [...new Set([...variants.values()].flatMap((set) => [...set]))].sort(),
    }));

  return {
    emailInMultipleFamilies: { count: multiFamily.length, rows: multiFamily },
    emailFieldDisagreesWithKey: rows.filter((row) => row.emailFieldDisagrees).length,
    counterpartEmailDisagrees: rows.filter((row) => row.counterpartEmailDisagrees).length,
    membersWithNoEmail: {
      total: membersWithNoEmailUidKeyed + membersWithNoEmailOtherKeyed,
      uidKeyed: membersWithNoEmailUidKeyed,
      otherKeyed: membersWithNoEmailOtherKeyed,
    },
    caseOrWhitespaceVariants: { count: caseVariants.length, rows: caseVariants },
  };
}

/**
 * Recompute the support console's Stale Invites rule
 * (`api/support/stale-invites/route.ts`) over the same complete data set, so
 * the migration can adopt one definition instead of two.
 *
 * The panel's rule: a member doc with `status === "invited"` and a non-empty
 * `email` field, where some other member in the same family has
 * `status === "active"` and the same lowercased `email` field.
 */
function reconcileStaleInvites(
  snapshot: EmailKeyingSnapshot,
  index: MemberIndex,
  rows: EmailKeyedMemberRow[],
) {
  const activeKeys = new Set<string>();
  for (const member of snapshot.members) {
    if (member.status === "active" && member.email) {
      activeKeys.add(`${member.familyId}:${member.email.toLowerCase()}`);
    }
  }

  const panelRows = snapshot.members.filter(
    (member) =>
      member.status === "invited" &&
      Boolean(member.email) &&
      activeKeys.has(`${member.familyId}:${member.email.toLowerCase()}`),
  );
  const panelKeys = new Set(
    panelRows.map((member) => `${member.familyId}:${member.memberId}`),
  );
  const panelUidKeyedRows = panelRows.filter((member) => !isEmailKeyed(member)).length;

  const auditRows = snapshot.members.filter((member) => {
    if (!isEmailKeyed(member)) return false;
    const row = rows.find(
      (candidate) =>
        candidate.familyId === member.familyId &&
        candidate.emailHash === emailHash(member.memberId),
    );
    return row?.disposition === "stale_orphan";
  });
  const auditKeys = new Set(auditRows.map((member) => `${member.familyId}:${member.memberId}`));

  const panelOnly = [...panelKeys].filter((key) => !auditKeys.has(key)).length;
  const auditOnly = [...auditKeys].filter((key) => !panelKeys.has(key)).length;

  const disagreements: string[] = [];
  if (panelUidKeyedRows > 0) {
    disagreements.push(
      `${panelUidKeyedRows} panel row(s) are uid-keyed member docs. The panel matches on the \`email\` FIELD, so it flags uid-keyed duplicates too; this audit only counts email-KEYED document ids, because only those are what the migration re-keys.`,
    );
  }
  const blankEmailField = snapshot.members.filter(
    (member) => isEmailKeyed(member) && !member.email.trim() && !member.deleted,
  ).length;
  if (blankEmailField > 0) {
    disagreements.push(
      `${blankEmailField} email-keyed member doc(s) have a blank \`email\` field. The panel requires that field to be set, so it cannot see them at all; this audit reads the document id.`,
    );
  }
  const claimedCounterparts = rows.filter(
    (row) => row.disposition === "stale_orphan" && row.status !== "invited",
  ).length;
  if (claimedCounterparts > 0) {
    disagreements.push(
      `${claimedCounterparts} stale orphan(s) have a status other than "invited" (e.g. "claimed"). The panel filters on \`status === "invited"\` only.`,
    );
  }
  if (index.byFamily.size > 0) {
    disagreements.push(
      "The panel reads members with `adminRunQuery({ limit: 2000 })`, a single unpaginated page. Above 2000 member docs across all families it silently under-counts — the same failure mode as the hard 500-family cap in `lib/newsletters/service.ts`. This audit pages with a cursor and asserts it reached the end.",
    );
  }
  const deletedCounterparts = rows.filter(
    (row) => row.disposition === "revoked_or_deleted",
  ).length;
  if (deletedCounterparts > 0) {
    disagreements.push(
      `${deletedCounterparts} email-keyed doc(s) are revoked or soft-deleted. The panel ignores the \`deleted\` flag, so it can list already-dead records as actionable.`,
    );
  }

  return {
    panelDefinitionCount: panelRows.length,
    auditDefinitionCount: auditRows.length,
    panelOnly,
    auditOnly,
    panelUidKeyedRows,
    disagreements,
  };
}

function analyzePrivateRelay(snapshot: EmailKeyingSnapshot) {
  const byLocation: Record<string, number> = {};
  let total = 0;
  // The generic sweep also visits members/users/inviteLookup/assignee fields, so
  // every location counted explicitly below is excluded from the sweep totals —
  // otherwise each relay address would be counted twice.
  const countedExplicitly = new Set<string>();
  const note = (location: string, hit: boolean) => {
    countedExplicitly.add(location);
    if (!hit) return;
    bump(byLocation, location);
    total += 1;
  };

  for (const member of snapshot.members) {
    note("members#documentId", isPrivateRelayEmail(member.memberId));
    note("members#email", isPrivateRelayEmail(member.email));
  }
  for (const user of snapshot.users) {
    note("users#email", isPrivateRelayEmail(user.email));
  }
  for (const lookup of snapshot.inviteLookups) {
    note("inviteLookup#documentId", isPrivateRelayEmail(lookup.docId));
    note("inviteLookup#email", isPrivateRelayEmail(lookup.email));
  }
  for (const ref of snapshot.assigneeRefs) {
    note(`${ref.collectionId}#${ref.fieldPath}`, isPrivateRelayEmail(ref.value));
  }
  for (const finding of snapshot.otherFindings) {
    const label = `${finding.collectionId}#${finding.fieldPath || "documentId"}`;
    if (finding.privateRelayCount > 0 && !countedExplicitly.has(label)) {
      bump(byLocation, label, finding.privateRelayCount);
      total += finding.privateRelayCount;
    }
  }

  return { total, byLocation };
}

function buildFamilyRows(
  snapshot: EmailKeyingSnapshot,
  index: MemberIndex,
  rows: EmailKeyedMemberRow[],
  stranded: EmailKeyingAudit["strandedUsers"],
  relayByFamily: Map<string, number>,
): FamilyAuditRow[] {
  const familyNames = new Map(
    snapshot.families.map((family) => [family.familyId, family] as const),
  );
  const familyIds = new Set<string>([
    ...snapshot.families.map((family) => family.familyId),
    ...index.byFamily.keys(),
  ]);

  return [...familyIds]
    .sort()
    .map((familyId) => {
      const members = index.byFamily.get(familyId) ?? [];
      const familyRows = rows.filter((row) => row.familyId === familyId);
      const refs = snapshot.assigneeRefs.filter((ref) => ref.familyId === familyId);
      const family = familyNames.get(familyId);
      return {
        familyId,
        familyName: family?.name ?? "(family document missing)",
        familyDeleted: family?.deleted ?? false,
        memberDocs: members.length,
        emailKeyedMemberDocs: familyRows.length,
        uidKeyedMemberDocs: members.length - familyRows.length,
        staleOrphans: familyRows.filter((row) => row.disposition === "stale_orphan").length,
        migratable: familyRows.filter((row) => row.disposition === "migratable").length,
        pendingInvites: familyRows.filter((row) => row.disposition === "pending_invite").length,
        revokedOrDeleted: familyRows.filter((row) => row.disposition === "revoked_or_deleted")
          .length,
        inviteLookupDocs: snapshot.inviteLookups.filter(
          (lookup) => lookup.familyId === familyId,
        ).length,
        emailAssigneeRefs: refs.length,
        emailAssigneeRefsDangling: refs.filter((ref) => !assigneeResolves(ref, index)).length,
        strandedUsers: stranded.rows.filter((row) => row.familyId === familyId).length,
        privateRelayHits: relayByFamily.get(familyId) ?? 0,
      };
    })
    .filter(
      (row) =>
        row.emailKeyedMemberDocs > 0 ||
        row.inviteLookupDocs > 0 ||
        row.emailAssigneeRefs > 0 ||
        row.strandedUsers > 0 ||
        row.privateRelayHits > 0,
    );
}

export function analyzeEmailKeying(snapshot: EmailKeyingSnapshot): EmailKeyingAudit {
  const index = indexMembers(snapshot.members);
  const usersByEmail = new Map<string, string>();
  const usersByUid = new Map<string, EmailKeyingSnapshot["users"][number]>();
  for (const user of snapshot.users) {
    usersByUid.set(user.uid, user);
    const key = normalizeEmail(user.email);
    if (key && !usersByEmail.has(key)) usersByEmail.set(key, user.uid);
  }

  const rows = buildEmailKeyedRows(snapshot, index, usersByEmail);
  const stranded = analyzeStrandedUsers(snapshot, index, usersByEmail, usersByUid);

  const relayByFamily = new Map<string, number>();
  for (const member of snapshot.members) {
    if (isPrivateRelayEmail(member.memberId) || isPrivateRelayEmail(member.email)) {
      relayByFamily.set(member.familyId, (relayByFamily.get(member.familyId) ?? 0) + 1);
    }
  }
  for (const ref of snapshot.assigneeRefs) {
    if (isPrivateRelayEmail(ref.value)) {
      relayByFamily.set(ref.familyId, (relayByFamily.get(ref.familyId) ?? 0) + 1);
    }
  }

  const byStatus: Record<string, number> = {};
  const byDisposition: Record<EmailKeyedMemberDisposition, number> = {
    stale_orphan: 0,
    migratable: 0,
    pending_invite: 0,
    revoked_or_deleted: 0,
  };
  for (const row of rows) {
    bump(byStatus, row.status);
    byDisposition[row.disposition] += 1;
  }

  const pendingInviteCount = rows.filter(
    (row) =>
      !row.deleted &&
      (row.status === "invited" || row.status === "claimed") &&
      (row.disposition === "pending_invite" || row.disposition === "migratable"),
  ).length;

  return {
    schemaVersion: 1,
    readAt: snapshot.readAt,
    projectId: snapshot.projectId,
    coverageComplete: snapshot.coverage.every((entry) => entry.complete),
    coverage: snapshot.coverage,
    redacted: !snapshot.includeRawEmails,
    totals: {
      families: snapshot.families.length,
      familiesWithEmailKeyedMembers: new Set(rows.map((row) => row.familyId)).size,
      memberDocs: snapshot.members.length,
      emailKeyedMemberDocs: rows.length,
      uidKeyedMemberDocs: snapshot.members.length - rows.length,
      users: snapshot.users.length,
      familyInvites: snapshot.familyInviteCount,
    },
    emailKeyedMembers: { total: rows.length, byStatus, byDisposition, pendingInviteCount, rows },
    inviteLookup: analyzeInviteLookup(snapshot, index),
    assigneeRefs: analyzeAssigneeRefs(snapshot, index),
    otherEmailKeyedLocations: snapshot.otherFindings,
    strandedUsers: stranded,
    privateRelay: analyzePrivateRelay(snapshot),
    edgeCases: analyzeEdgeCases(snapshot, rows),
    staleInvitesReconciliation: reconcileStaleInvites(snapshot, index, rows),
    families: buildFamilyRows(snapshot, index, rows, stranded, relayByFamily),
  } satisfies EmailKeyingAudit;
}
