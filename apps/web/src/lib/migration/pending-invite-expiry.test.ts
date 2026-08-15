import { describe, expect, it } from "vitest";
import { planPendingInviteExpiry } from "@/lib/migration/pending-invite-expiry";
import type { ChoreAssigneeRecord } from "@/lib/migration/chore-assignee-rewrite";
import type { MemberRecord } from "@/lib/migration/email-keying-types";

const FAMILY = "famA";

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

function chore(overrides: Partial<ChoreAssigneeRecord> = {}): ChoreAssigneeRecord {
  return {
    familyId: FAMILY,
    choreId: "chore-1",
    status: "Open",
    deleted: false,
    assigneeId: "",
    assigneeIds: [],
    ...overrides,
  };
}

const PENDING = member({
  memberId: "kid@example.com",
  email: "kid@example.com",
  status: "invited",
});

describe("planPendingInviteExpiry — which invites expire", () => {
  it("expires a live email-keyed invitation", () => {
    const { expiries, skips } = planPendingInviteExpiry({ members: [PENDING], chores: [] });
    expect(skips).toHaveLength(0);
    expect(expiries).toEqual([
      {
        familyId: FAMILY,
        memberId: "kid@example.com",
        email: "kid@example.com",
        status: "invited",
        role: "player",
      },
    ]);
  });

  it("expires a claimed-but-not-active invitation too", () => {
    const { expiries } = planPendingInviteExpiry({
      members: [member({ ...PENDING, status: "claimed" })],
      chores: [],
    });
    expect(expiries).toHaveLength(1);
  });

  it("leaves a stale duplicate alone — that is a delete, not an expiry", () => {
    const { expiries, skips } = planPendingInviteExpiry({
      members: [PENDING, member({ memberId: "kid-uid", uid: "kid-uid", email: "kid@example.com" })],
      chores: [],
    });
    expect(expiries).toHaveLength(0);
    expect(skips[0]).toMatchObject({ reason: "has_uid_counterpart" });
  });

  it("ignores already-deleted and non-pending email docs", () => {
    const { expiries, skips } = planPendingInviteExpiry({
      members: [
        member({ memberId: "a@example.com", status: "invited", deleted: true }),
        member({ memberId: "b@example.com", status: "revoked" }),
      ],
      chores: [],
    });
    expect(expiries).toHaveLength(0);
    expect(skips.map((skip) => skip.reason).sort()).toEqual(["already_deleted", "not_pending"]);
  });

  it("never touches uid-keyed member docs", () => {
    const { expiries, skips } = planPendingInviteExpiry({
      members: [member({ memberId: "kid-uid", uid: "kid-uid", status: "invited" })],
      chores: [],
    });
    expect(expiries).toHaveLength(0);
    expect(skips).toHaveLength(0);
  });
});

describe("planPendingInviteExpiry — chore fallout", () => {
  it("soft-deletes a chore whose only assignee was expired", () => {
    const { choreActions } = planPendingInviteExpiry({
      members: [PENDING],
      chores: [chore({ assigneeId: "kid@example.com", assigneeIds: ["kid@example.com"] })],
    });
    expect(choreActions).toEqual([
      {
        kind: "soft_delete",
        familyId: FAMILY,
        choreId: "chore-1",
        status: "Open",
        reason: "only_assignee_expired",
      },
    ]);
  });

  it("keeps a shared chore and only drops the expired assignee", () => {
    const { choreActions } = planPendingInviteExpiry({
      members: [PENDING],
      chores: [
        chore({ assigneeId: "kid@example.com", assigneeIds: ["kid@example.com", "sib-uid"] }),
      ],
    });
    expect(choreActions[0]).toMatchObject({
      kind: "remove_assignee",
      nextAssigneeId: "sib-uid",
      nextAssigneeIds: ["sib-uid"],
    });
  });

  it("leaves chores that do not reference an expired invitee", () => {
    const { choreActions } = planPendingInviteExpiry({
      members: [PENDING],
      chores: [chore({ assigneeId: "sib-uid", assigneeIds: ["sib-uid"] })],
    });
    expect(choreActions).toHaveLength(0);
  });

  it("leaves already-deleted chores alone", () => {
    const { choreActions } = planPendingInviteExpiry({
      members: [PENDING],
      chores: [chore({ assigneeId: "kid@example.com", deleted: true, status: "Deleted" })],
    });
    expect(choreActions).toHaveLength(0);
  });

  it("does not touch a chore in a different family", () => {
    const { choreActions } = planPendingInviteExpiry({
      members: [PENDING],
      chores: [chore({ familyId: "famB", assigneeId: "kid@example.com" })],
    });
    expect(choreActions).toHaveLength(0);
  });

  it("matches the member's stored email as well as its document key", () => {
    const { choreActions } = planPendingInviteExpiry({
      members: [member({ memberId: "old@example.com", email: "new@example.com", status: "invited" })],
      chores: [chore({ assigneeId: "new@example.com", assigneeIds: ["new@example.com"] })],
    });
    expect(choreActions[0]).toMatchObject({ kind: "soft_delete" });
  });

  it("produces no chore fallout when nothing was expired", () => {
    const { choreActions } = planPendingInviteExpiry({
      members: [member({ memberId: "kid-uid", uid: "kid-uid", email: "kid@example.com" })],
      chores: [chore({ assigneeId: "kid@example.com", assigneeIds: ["kid@example.com"] })],
    });
    expect(choreActions).toHaveLength(0);
  });
});
