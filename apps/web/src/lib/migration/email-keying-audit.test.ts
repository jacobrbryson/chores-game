import { describe, expect, it } from "vitest";
import {
  analyzeEmailKeying,
  emailHash,
  looksLikeEmail,
  redactEmail,
} from "@/lib/migration/email-keying-audit";
import { renderEmailKeyingReport } from "@/lib/migration/email-keying-report";
import type {
  AssigneeRefRecord,
  EmailKeyingSnapshot,
  MemberRecord,
  UserRecord,
} from "@/lib/migration/email-keying-types";

function member(overrides: Partial<MemberRecord> & Pick<MemberRecord, "familyId" | "memberId">) {
  return {
    email: "",
    uid: "",
    name: "Member",
    status: "active",
    role: "player",
    deleted: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } satisfies MemberRecord;
}

function user(overrides: Partial<UserRecord> & Pick<UserRecord, "uid">) {
  return { email: "", familyIds: [], provider: "google", ...overrides } satisfies UserRecord;
}

function assigneeRef(
  overrides: Partial<AssigneeRefRecord> & Pick<AssigneeRefRecord, "familyId" | "value">,
) {
  return {
    collectionId: "chores",
    docId: "chore-1",
    fieldPath: "assigneeId",
    status: "Open",
    deleted: false,
    ...overrides,
  } satisfies AssigneeRefRecord;
}

function snapshot(overrides: Partial<EmailKeyingSnapshot> = {}): EmailKeyingSnapshot {
  return {
    readAt: "2026-08-13T00:00:00.000Z",
    projectId: "test-project",
    families: [{ familyId: "famA", name: "Family A", deleted: false, createdAt: "" }],
    members: [],
    users: [],
    inviteLookups: [],
    assigneeRefs: [],
    otherFindings: [],
    coverage: [
      {
        collectionId: "members",
        scope: "collectionGroup",
        documentsScanned: 0,
        cap: 1000,
        complete: true,
      },
    ],
    familyInviteCount: 0,
    includeRawEmails: false,
    ...overrides,
  };
}

describe("looksLikeEmail", () => {
  it("accepts real addresses and rejects uids", () => {
    expect(looksLikeEmail("kid@example.com")).toBe(true);
    expect(looksLikeEmail("x7k2p9@privaterelay.appleid.com")).toBe(true);
    expect(looksLikeEmail("HrK3nQ9zXyAbCd")).toBe(false);
    expect(looksLikeEmail("")).toBe(false);
    expect(looksLikeEmail("no-at-sign.com")).toBe(false);
    expect(looksLikeEmail("missing@tld")).toBe(false);
  });
});

describe("redactEmail", () => {
  it("keeps the domain and drops the local part", () => {
    expect(redactEmail("Kid.Name@Example.com")).toBe("k***@example.com");
    expect(redactEmail("")).toBe("");
  });

  it("hashes stably across casing so redacted rows can still be correlated", () => {
    expect(emailHash("Kid@Example.com")).toBe(emailHash("kid@example.com"));
  });
});

describe("email-keyed member dispositions", () => {
  it("marks an email doc with a uid-keyed counterpart as a stale orphan", () => {
    const audit = analyzeEmailKeying(
      snapshot({
        members: [
          member({ familyId: "famA", memberId: "kid@example.com", email: "kid@example.com", status: "invited" }),
          member({ familyId: "famA", memberId: "kid-uid", email: "kid@example.com", uid: "kid-uid" }),
        ],
      }),
    );
    expect(audit.emailKeyedMembers.byDisposition.stale_orphan).toBe(1);
    expect(audit.emailKeyedMembers.rows[0]?.counterpartMemberId).toBe("kid-uid");
    expect(audit.emailKeyedMembers.rows[0]?.resolvedVia).toBe("member_email");
  });

  it("marks an email doc with a known uid but no uid doc as migratable, not deletable", () => {
    const audit = analyzeEmailKeying(
      snapshot({
        members: [
          member({ familyId: "famA", memberId: "kid@example.com", email: "kid@example.com", status: "claimed" }),
        ],
        users: [user({ uid: "kid-uid", email: "kid@example.com", familyIds: ["famA"] })],
      }),
    );
    expect(audit.emailKeyedMembers.byDisposition.migratable).toBe(1);
    expect(audit.emailKeyedMembers.byDisposition.stale_orphan).toBe(0);
    expect(audit.emailKeyedMembers.rows[0]?.knownUid).toBe("kid-uid");
  });

  it("marks an email doc with no uid anywhere as a pending invite", () => {
    const audit = analyzeEmailKeying(
      snapshot({
        members: [
          member({ familyId: "famA", memberId: "new@example.com", email: "new@example.com", status: "invited" }),
        ],
      }),
    );
    expect(audit.emailKeyedMembers.byDisposition.pending_invite).toBe(1);
    expect(audit.emailKeyedMembers.pendingInviteCount).toBe(1);
  });

  it("does not treat a soft-deleted counterpart as covering the person", () => {
    const audit = analyzeEmailKeying(
      snapshot({
        members: [
          member({ familyId: "famA", memberId: "kid@example.com", email: "kid@example.com", status: "invited" }),
          member({
            familyId: "famA",
            memberId: "kid-uid",
            email: "kid@example.com",
            uid: "kid-uid",
            deleted: true,
          }),
        ],
      }),
    );
    expect(audit.emailKeyedMembers.byDisposition.stale_orphan).toBe(0);
    expect(audit.emailKeyedMembers.byDisposition.pending_invite).toBe(1);
  });

  it("classifies revoked and soft-deleted email docs as inert", () => {
    const audit = analyzeEmailKeying(
      snapshot({
        members: [
          member({ familyId: "famA", memberId: "a@example.com", status: "revoked" }),
          member({ familyId: "famA", memberId: "b@example.com", status: "invited", deleted: true }),
        ],
      }),
    );
    expect(audit.emailKeyedMembers.byDisposition.revoked_or_deleted).toBe(2);
    expect(audit.emailKeyedMembers.pendingInviteCount).toBe(0);
  });

  it("does not match a counterpart across family boundaries", () => {
    const audit = analyzeEmailKeying(
      snapshot({
        families: [
          { familyId: "famA", name: "A", deleted: false, createdAt: "" },
          { familyId: "famB", name: "B", deleted: false, createdAt: "" },
        ],
        members: [
          member({ familyId: "famA", memberId: "kid@example.com", email: "kid@example.com", status: "invited" }),
          member({ familyId: "famB", memberId: "kid-uid", email: "kid@example.com", uid: "kid-uid" }),
        ],
      }),
    );
    expect(audit.emailKeyedMembers.byDisposition.stale_orphan).toBe(0);
  });
});

describe("assignee references", () => {
  it("separates refs that resolve to a live member from refs that dangle", () => {
    const audit = analyzeEmailKeying(
      snapshot({
        members: [
          member({ familyId: "famA", memberId: "kid@example.com", email: "kid@example.com", status: "invited" }),
        ],
        assigneeRefs: [
          assigneeRef({ familyId: "famA", value: "kid@example.com" }),
          assigneeRef({ familyId: "famA", value: "gone@example.com", docId: "chore-2" }),
          assigneeRef({
            familyId: "famA",
            value: "kid@example.com",
            collectionId: "routineAssignments",
            docId: "ra-1",
          }),
        ],
      }),
    );
    expect(audit.assigneeRefs.total).toBe(3);
    expect(audit.assigneeRefs.resolves).toBe(2);
    expect(audit.assigneeRefs.dangles).toBe(1);
    expect(audit.assigneeRefs.byCollection.chores).toEqual({ total: 2, resolves: 1, dangles: 1 });
    expect(audit.assigneeRefs.byCollection.routineAssignments?.resolves).toBe(1);
    expect(audit.assigneeRefs.onOpenChores).toBe(3);
  });

  it("resolves against a uid-keyed member's email field too", () => {
    const audit = analyzeEmailKeying(
      snapshot({
        members: [member({ familyId: "famA", memberId: "kid-uid", email: "kid@example.com", uid: "kid-uid" })],
        assigneeRefs: [assigneeRef({ familyId: "famA", value: "KID@example.com" })],
      }),
    );
    expect(audit.assigneeRefs.resolves).toBe(1);
  });
});

describe("stranded users", () => {
  it("counts a user with an email-keyed member doc and empty familyIds", () => {
    const audit = analyzeEmailKeying(
      snapshot({
        members: [
          member({ familyId: "famA", memberId: "kid@example.com", email: "kid@example.com", status: "invited" }),
        ],
        users: [user({ uid: "kid-uid", email: "kid@example.com", familyIds: [] })],
      }),
    );
    expect(audit.strandedUsers.familyIdsEmpty).toBe(1);
    expect(audit.strandedUsers.rows[0]?.reason).toBe("family_ids_empty");
  });

  it("counts a user whose familyIds omits the family they were invited to", () => {
    const audit = analyzeEmailKeying(
      snapshot({
        members: [
          member({ familyId: "famA", memberId: "kid@example.com", email: "kid@example.com", status: "invited" }),
        ],
        users: [user({ uid: "kid-uid", email: "kid@example.com", familyIds: ["famZ"] })],
      }),
    );
    expect(audit.strandedUsers.familyIdsMissingThatFamily).toBe(1);
  });

  it("does not count a person who never signed in as stranded-with-an-account", () => {
    const audit = analyzeEmailKeying(
      snapshot({
        members: [
          member({ familyId: "famA", memberId: "new@example.com", email: "new@example.com", status: "invited" }),
        ],
      }),
    );
    expect(audit.strandedUsers.familyIdsEmpty).toBe(0);
    expect(audit.strandedUsers.noUserDoc).toBe(1);
  });

  it("does not count an already-accepted member as stranded", () => {
    const audit = analyzeEmailKeying(
      snapshot({
        members: [
          member({ familyId: "famA", memberId: "kid@example.com", email: "kid@example.com", status: "invited" }),
          member({ familyId: "famA", memberId: "kid-uid", email: "kid@example.com", uid: "kid-uid" }),
        ],
        users: [user({ uid: "kid-uid", email: "kid@example.com", familyIds: ["famA"] })],
      }),
    );
    expect(audit.strandedUsers.rows).toHaveLength(0);
  });
});

describe("inviteLookup", () => {
  it("reports dangling family and member references", () => {
    const audit = analyzeEmailKeying(
      snapshot({
        members: [
          member({ familyId: "famA", memberId: "kid@example.com", email: "kid@example.com", status: "invited" }),
        ],
        inviteLookups: [
          { docId: "kid@example.com", email: "kid@example.com", familyId: "famA", status: "invited" },
          { docId: "ghost@example.com", email: "ghost@example.com", familyId: "famGone", status: "invited" },
          { docId: "nomember@example.com", email: "nomember@example.com", familyId: "famA", status: "invited" },
        ],
      }),
    );
    expect(audit.inviteLookup.total).toBe(3);
    expect(audit.inviteLookup.familyMissing).toBe(1);
    expect(audit.inviteLookup.memberMissing).toBe(1);
    expect(audit.inviteLookup.byStatus.invited).toBe(3);
  });

  it("flags a lookup whose person already has an active uid-keyed member doc", () => {
    const audit = analyzeEmailKeying(
      snapshot({
        members: [member({ familyId: "famA", memberId: "kid-uid", email: "kid@example.com", uid: "kid-uid" })],
        inviteLookups: [
          { docId: "kid@example.com", email: "kid@example.com", familyId: "famA", status: "invited" },
        ],
      }),
    );
    expect(audit.inviteLookup.orphanedByAcceptedMember).toBe(1);
  });
});

describe("private relay and edge cases", () => {
  it("counts relay addresses wherever they are persisted", () => {
    const audit = analyzeEmailKeying(
      snapshot({
        members: [
          member({
            familyId: "famA",
            memberId: "x7k2p9@privaterelay.appleid.com",
            email: "x7k2p9@privaterelay.appleid.com",
            status: "invited",
          }),
        ],
        users: [user({ uid: "relay-uid", email: "x7k2p9@privaterelay.appleid.com" })],
        assigneeRefs: [assigneeRef({ familyId: "famA", value: "x7k2p9@privaterelay.appleid.com" })],
      }),
    );
    expect(audit.privateRelay.total).toBe(4);
    expect(audit.privateRelay.byLocation["members#documentId"]).toBe(1);
    expect(audit.privateRelay.byLocation["users#email"]).toBe(1);
    expect(audit.emailKeyedMembers.rows[0]?.isPrivateRelay).toBe(true);
  });

  it("does not double-count a relay address that the generic sweep also saw", () => {
    const relay = "x7k2p9@privaterelay.appleid.com";
    const audit = analyzeEmailKeying(
      snapshot({
        members: [member({ familyId: "famA", memberId: relay, email: relay, status: "invited" })],
        otherFindings: [
          // The sweep visits `members` too, so these overlap with the explicit
          // member scan above and must not be added on top of it.
          {
            collectionId: "members",
            location: "documentId",
            fieldPath: "",
            documentCount: 1,
            valueCount: 1,
            distinctEmails: 1,
            privateRelayCount: 1,
            sampleValues: [],
          },
          {
            collectionId: "members",
            location: "field",
            fieldPath: "email",
            documentCount: 1,
            valueCount: 1,
            distinctEmails: 1,
            privateRelayCount: 1,
            sampleValues: [],
          },
          // A collection the explicit scans never touch still counts.
          {
            collectionId: "awardClaims",
            location: "field",
            fieldPath: "purchaserEmail",
            documentCount: 1,
            valueCount: 1,
            distinctEmails: 1,
            privateRelayCount: 1,
            sampleValues: [],
          },
        ],
      }),
    );
    expect(audit.privateRelay.byLocation["members#documentId"]).toBe(1);
    expect(audit.privateRelay.byLocation["members#email"]).toBe(1);
    expect(audit.privateRelay.byLocation["awardClaims#purchaserEmail"]).toBe(1);
    expect(audit.privateRelay.total).toBe(3);
  });

  it("counts the same email keyed in more than one family", () => {
    const audit = analyzeEmailKeying(
      snapshot({
        families: [
          { familyId: "famA", name: "A", deleted: false, createdAt: "" },
          { familyId: "famB", name: "B", deleted: false, createdAt: "" },
        ],
        members: [
          member({ familyId: "famA", memberId: "kid@example.com", email: "kid@example.com", status: "invited" }),
          member({ familyId: "famB", memberId: "kid@example.com", email: "kid@example.com", status: "invited" }),
        ],
      }),
    );
    expect(audit.edgeCases.emailInMultipleFamilies.count).toBe(1);
    expect(audit.edgeCases.emailInMultipleFamilies.rows[0]?.familyIds).toEqual(["famA", "famB"]);
  });

  it("flags an email-keyed doc whose email field disagrees with its own id", () => {
    const audit = analyzeEmailKeying(
      snapshot({
        members: [
          member({ familyId: "famA", memberId: "old@example.com", email: "new@example.com", status: "invited" }),
        ],
      }),
    );
    expect(audit.edgeCases.emailFieldDisagreesWithKey).toBe(1);
  });

  it("flags addresses differing only by case", () => {
    const audit = analyzeEmailKeying(
      snapshot({
        members: [
          member({ familyId: "famA", memberId: "kid@example.com", email: "Kid@Example.com", status: "invited" }),
        ],
      }),
    );
    expect(audit.edgeCases.caseOrWhitespaceVariants.count).toBe(1);
    expect(audit.edgeCases.caseOrWhitespaceVariants.rows[0]?.locations).toContain(
      "members/famA#email",
    );
  });

  it("counts live members that carry no email at all", () => {
    const audit = analyzeEmailKeying(
      snapshot({
        members: [member({ familyId: "famA", memberId: "kiosk-uid", uid: "kiosk-uid", email: "" })],
      }),
    );
    expect(audit.edgeCases.membersWithNoEmail.total).toBe(1);
  });
});

describe("stale invites reconciliation", () => {
  it("shows where the support panel's rule and this audit's rule diverge", () => {
    const audit = analyzeEmailKeying(
      snapshot({
        members: [
          // Both definitions agree: email-keyed invited doc with an active twin.
          member({ familyId: "famA", memberId: "kid@example.com", email: "kid@example.com", status: "invited" }),
          member({ familyId: "famA", memberId: "kid-uid", email: "kid@example.com", uid: "kid-uid" }),
          // Panel-only: a uid-keyed invited duplicate. Not a migration target.
          member({ familyId: "famA", memberId: "dup-uid", email: "sib@example.com", status: "invited" }),
          member({ familyId: "famA", memberId: "sib-uid", email: "sib@example.com", uid: "sib-uid" }),
          // Audit-only: email-keyed, blank email field, so the panel cannot see it.
          member({ familyId: "famA", memberId: "ghost@example.com", email: "", status: "invited" }),
          member({ familyId: "famA", memberId: "ghost-uid", email: "ghost@example.com", uid: "ghost-uid" }),
        ],
      }),
    );
    expect(audit.staleInvitesReconciliation.panelDefinitionCount).toBe(2);
    expect(audit.staleInvitesReconciliation.auditDefinitionCount).toBe(2);
    expect(audit.staleInvitesReconciliation.panelUidKeyedRows).toBe(1);
    expect(audit.staleInvitesReconciliation.panelOnly).toBe(1);
    expect(audit.staleInvitesReconciliation.auditOnly).toBe(1);
    expect(audit.staleInvitesReconciliation.disagreements.length).toBeGreaterThan(0);
  });
});

describe("coverage", () => {
  it("propagates a truncated scan as an incomplete audit", () => {
    const audit = analyzeEmailKeying(
      snapshot({
        coverage: [
          {
            collectionId: "chores",
            scope: "collectionGroup",
            documentsScanned: 1000,
            cap: 1000,
            complete: false,
          },
        ],
      }),
    );
    expect(audit.coverageComplete).toBe(false);
  });
});

describe("report rendering", () => {
  it("renders every section and never leaks a raw address when redacting", () => {
    const audit = analyzeEmailKeying(
      snapshot({
        members: [
          member({ familyId: "famA", memberId: "kid@example.com", email: "kid@example.com", status: "invited" }),
        ],
        assigneeRefs: [assigneeRef({ familyId: "famA", value: "kid@example.com" })],
        otherFindings: [
          {
            collectionId: "notifications",
            location: "field",
            fieldPath: "relatedIds[]",
            documentCount: 2,
            valueCount: 2,
            distinctEmails: 1,
            privateRelayCount: 0,
            sampleValues: ["k***@example.com"],
          },
        ],
      }),
    );
    const markdown = renderEmailKeyingReport(audit);
    expect(markdown).toContain("# Email-keying migration — READ-ONLY dry run");
    expect(markdown).toContain("This run wrote nothing");
    expect(markdown).toContain("Stale Invites panel");
    expect(markdown).toContain("relatedIds[]");
    expect(markdown).toContain("k***@example.com");
    expect(markdown).not.toContain("kid@example.com");
  });
});
