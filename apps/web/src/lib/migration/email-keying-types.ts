/**
 * Input and output shapes for the email-keying migration dry run.
 *
 * The audit is deliberately split into a pure analysis module (this file plus
 * `email-keying-audit.ts` / `email-keying-report.ts`) and a Firestore-reading
 * runner (`scripts/email-keying-dry-run.ts`). Everything here operates on plain
 * records so the classification rules — which decide what a later migration
 * deletes versus rewrites — are unit-testable without a database.
 *
 * Data classification: every record here can carry an email address, which is
 * `CHILD_SENSITIVE`. The audit output redacts addresses by default; see
 * `redactEmail` in `email-keying-audit.ts`.
 */

/** A `families/{familyId}/members/{memberId}` document, flattened. */
export type MemberRecord = {
  familyId: string;
  /** The document id. Email-keyed when it parses as an email address. */
  memberId: string;
  /** The `email` field as stored — NOT normalized, so casing/whitespace drift is visible. */
  email: string;
  uid: string;
  name: string;
  status: string;
  role: string;
  deleted: boolean;
  createdAt: string;
};

/** A top-level `users/{uid}` document, flattened. */
export type UserRecord = {
  uid: string;
  email: string;
  familyIds: string[];
  provider: string;
};

/** A top-level `inviteLookup/{email}` index document, flattened. */
export type InviteLookupRecord = {
  /** The document id, which is the invited email address. */
  docId: string;
  email: string;
  familyId: string;
  status: string;
};

/** A top-level `families/{familyId}` document, flattened. */
export type FamilyRecord = {
  familyId: string;
  name: string;
  deleted: boolean;
  createdAt: string;
};

/**
 * One email-shaped value found in an assignee identity field (`assigneeId`,
 * `assigneeIds[]`) on a chore or routine assignment.
 */
export type AssigneeRefRecord = {
  familyId: string;
  collectionId: string;
  docId: string;
  fieldPath: string;
  value: string;
  status: string;
  deleted: boolean;
};

/**
 * A collection/field pair discovered by the generic sweep to hold email-shaped
 * values. This is what answers "any OTHER collection that stores an email as an
 * identity key" without assuming the hand-written list is complete.
 */
export type EmailFieldFinding = {
  collectionId: string;
  location: "documentId" | "field";
  /** "" for documentId findings. Array fields are reported as `field[]`. */
  fieldPath: string;
  documentCount: number;
  valueCount: number;
  distinctEmails: number;
  privateRelayCount: number;
  /** Redacted unless the run opted into raw addresses. */
  sampleValues: string[];
};

/** Proof that a collection scan actually reached the end of the collection. */
export type ScanCoverage = {
  collectionId: string;
  scope: "collection" | "collectionGroup";
  documentsScanned: number;
  cap: number;
  /** False means the safety cap was hit and the numbers below it under-count. */
  complete: boolean;
};

/** Everything the runner read, handed to the pure analyzer in one shot. */
export type EmailKeyingSnapshot = {
  readAt: string;
  projectId: string;
  families: FamilyRecord[];
  members: MemberRecord[];
  users: UserRecord[];
  inviteLookups: InviteLookupRecord[];
  assigneeRefs: AssigneeRefRecord[];
  otherFindings: EmailFieldFinding[];
  coverage: ScanCoverage[];
  /** Count of `familyInvites` docs — the new token flow, for scale comparison. */
  familyInviteCount: number;
  /** When false, addresses in the output are redacted. */
  includeRawEmails: boolean;
};

/**
 * How an email-keyed member document should be treated by the migration.
 *
 * - `stale_orphan`     — a uid-keyed member doc for the same person already
 *                        exists in the same family. Safe to delete.
 * - `migratable`       — no uid-keyed counterpart, but the person's uid IS
 *                        known (on the member doc or via `users`). Must be
 *                        rewritten to `members/{uid}`, not dropped.
 * - `pending_invite`   — no uid-keyed counterpart and no known uid. A genuinely
 *                        pending invite; must keep its email key until redeemed
 *                        (or be expired and re-issued through the token flow).
 * - `revoked_or_deleted` — already revoked/soft-deleted. Inert.
 */
export type EmailKeyedMemberDisposition =
  | "stale_orphan"
  | "migratable"
  | "pending_invite"
  | "revoked_or_deleted";

export type EmailKeyedMemberRow = {
  familyId: string;
  /** Redacted unless the run opted into raw addresses. */
  emailKey: string;
  /** Stable correlation handle that survives redaction. */
  emailHash: string;
  status: string;
  role: string;
  deleted: boolean;
  disposition: EmailKeyedMemberDisposition;
  /** The uid-keyed member doc id that covers this person, when one exists. */
  counterpartMemberId: string;
  /** How the counterpart/uid was established. */
  resolvedVia: "none" | "member_email" | "member_uid" | "user_email";
  /** The person's uid, when known. */
  knownUid: string;
  isPrivateRelay: boolean;
  /** True when the doc's `email` field disagrees with its own document id. */
  emailFieldDisagrees: boolean;
  /** True when the counterpart uid doc's email disagrees with this doc's key. */
  counterpartEmailDisagrees: boolean;
};

export type FamilyAuditRow = {
  familyId: string;
  familyName: string;
  familyDeleted: boolean;
  memberDocs: number;
  emailKeyedMemberDocs: number;
  uidKeyedMemberDocs: number;
  staleOrphans: number;
  migratable: number;
  pendingInvites: number;
  revokedOrDeleted: number;
  inviteLookupDocs: number;
  emailAssigneeRefs: number;
  emailAssigneeRefsDangling: number;
  strandedUsers: number;
  privateRelayHits: number;
};

export type EmailKeyingAudit = {
  schemaVersion: 1;
  readAt: string;
  projectId: string;
  /** False if ANY scan hit its cap; every count below is then a lower bound. */
  coverageComplete: boolean;
  coverage: ScanCoverage[];
  redacted: boolean;
  /** Per-family rows, limited to families that actually carry email keying. */
  families: FamilyAuditRow[];
  totals: {
    families: number;
    familiesWithEmailKeyedMembers: number;
    memberDocs: number;
    emailKeyedMemberDocs: number;
    uidKeyedMemberDocs: number;
    users: number;
    familyInvites: number;
  };
  emailKeyedMembers: {
    total: number;
    byStatus: Record<string, number>;
    byDisposition: Record<EmailKeyedMemberDisposition, number>;
    /** Non-deleted invited/claimed docs with no uid-keyed counterpart. */
    pendingInviteCount: number;
    rows: EmailKeyedMemberRow[];
  };
  inviteLookup: {
    total: number;
    byStatus: Record<string, number>;
    familyMissing: number;
    familyDeleted: number;
    memberMissing: number;
    memberDeleted: number;
    orphanedByAcceptedMember: number;
    privateRelay: number;
  };
  assigneeRefs: {
    total: number;
    byCollection: Record<string, { total: number; resolves: number; dangles: number }>;
    resolves: number;
    dangles: number;
    onDeletedDocs: number;
    onOpenChores: number;
    privateRelay: number;
    samples: Array<{
      familyId: string;
      collectionId: string;
      docId: string;
      fieldPath: string;
      value: string;
      resolved: boolean;
      status: string;
      deleted: boolean;
    }>;
  };
  otherEmailKeyedLocations: EmailFieldFinding[];
  strandedUsers: {
    /** Has an email-keyed member doc AND `users/{uid}.familyIds` is empty. */
    familyIdsEmpty: number;
    /** Has an email-keyed member doc but familyIds omits THAT family. */
    familyIdsMissingThatFamily: number;
    /** Email-keyed member doc exists but no `users` doc matches at all. */
    noUserDoc: number;
    rows: Array<{
      familyId: string;
      emailKey: string;
      emailHash: string;
      uid: string;
      reason: "family_ids_empty" | "family_ids_missing_family" | "no_user_doc";
      memberStatus: string;
    }>;
  };
  privateRelay: {
    total: number;
    byLocation: Record<string, number>;
  };
  edgeCases: {
    emailInMultipleFamilies: {
      count: number;
      rows: Array<{ emailKey: string; emailHash: string; familyIds: string[] }>;
    };
    emailFieldDisagreesWithKey: number;
    counterpartEmailDisagrees: number;
    membersWithNoEmail: { total: number; uidKeyed: number; otherKeyed: number };
    caseOrWhitespaceVariants: {
      count: number;
      rows: Array<{ emailHash: string; variants: string[]; locations: string[] }>;
    };
  };
  staleInvitesReconciliation: {
    /** The panel's own rule, recomputed here over the complete data set. */
    panelDefinitionCount: number;
    /** This audit's `stale_orphan` disposition. */
    auditDefinitionCount: number;
    /** Panel-only: counted stale by the panel, not by this audit. */
    panelOnly: number;
    /** Audit-only: this audit says stale, the panel misses it. */
    auditOnly: number;
    /** Panel rows that are uid-keyed docs — outside the migration's scope. */
    panelUidKeyedRows: number;
    disagreements: string[];
  };
};
