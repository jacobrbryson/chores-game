import { describe, expect, it } from "vitest";
import {
  countEmailRefs,
  isLiveChore,
  planChoreAssigneeRewrites,
  type ChoreAssigneeRecord,
} from "@/lib/migration/chore-assignee-rewrite";
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

function members(list: MemberRecord[]) {
  const map = new Map<string, MemberRecord[]>();
  for (const entry of list) {
    const bucket = map.get(entry.familyId) ?? [];
    bucket.push(entry);
    map.set(entry.familyId, bucket);
  }
  return map;
}

function chore(overrides: Partial<ChoreAssigneeRecord> = {}): ChoreAssigneeRecord {
  return {
    familyId: FAMILY,
    choreId: "chore-1",
    status: "Open",
    deleted: false,
    assigneeId: "kid@example.com",
    assigneeIds: ["kid@example.com"],
    ...overrides,
  };
}

const KID = member({ memberId: "kid-uid", uid: "kid-uid", email: "kid@example.com" });

describe("isLiveChore", () => {
  it("counts only Open and Submitted non-deleted chores", () => {
    expect(isLiveChore(chore({ status: "Open" }))).toBe(true);
    expect(isLiveChore(chore({ status: "Submitted" }))).toBe(true);
    expect(isLiveChore(chore({ status: "Approved" }))).toBe(false);
    expect(isLiveChore(chore({ status: "Open", deleted: true }))).toBe(false);
  });
});

describe("countEmailRefs", () => {
  it("counts references, not chores — a chore can hold two", () => {
    expect(countEmailRefs([chore()])).toBe(2);
    expect(countEmailRefs([chore({ assigneeIds: [] })])).toBe(1);
    expect(countEmailRefs([chore({ assigneeId: "kid-uid", assigneeIds: ["kid-uid"] })])).toBe(0);
  });
});

describe("planChoreAssigneeRewrites", () => {
  it("rewrites both fields when one member matches", () => {
    const { rewrites, skips } = planChoreAssigneeRewrites([chore()], members([KID]));
    expect(skips).toHaveLength(0);
    expect(rewrites).toHaveLength(1);
    expect(rewrites[0]).toMatchObject({
      nextAssigneeId: "kid-uid",
      nextAssigneeIds: ["kid-uid"],
      changedFields: ["assigneeId", "assigneeIds"],
    });
  });

  it("refuses to rewrite when no uid-keyed member carries the email", () => {
    const { rewrites, skips } = planChoreAssigneeRewrites([chore()], members([]));
    expect(rewrites).toHaveLength(0);
    expect(skips[0]).toMatchObject({ reason: "no_uid_keyed_member", email: "kid@example.com" });
  });

  it("refuses to rewrite when two members share the email", () => {
    const twin = member({ memberId: "twin-uid", uid: "twin-uid", email: "kid@example.com" });
    const { rewrites, skips } = planChoreAssigneeRewrites([chore()], members([KID, twin]));
    expect(rewrites).toHaveLength(0);
    expect(skips[0]).toMatchObject({ reason: "ambiguous_members" });
  });

  it("ignores an email-keyed member doc as a rewrite target — it has no uid", () => {
    const pending = member({
      memberId: "kid@example.com",
      email: "kid@example.com",
      status: "invited",
    });
    const { rewrites, skips } = planChoreAssigneeRewrites([chore()], members([pending]));
    expect(rewrites).toHaveLength(0);
    expect(skips[0]).toMatchObject({ reason: "no_uid_keyed_member" });
  });

  it("never matches a member from another family", () => {
    const other = member({ familyId: "famB", memberId: "kid-uid", email: "kid@example.com" });
    const { rewrites, skips } = planChoreAssigneeRewrites([chore()], members([other]));
    expect(rewrites).toHaveLength(0);
    expect(skips[0]).toMatchObject({ reason: "no_uid_keyed_member" });
  });

  it("ignores soft-deleted members as rewrite targets", () => {
    const gone = member({ memberId: "kid-uid", uid: "kid-uid", email: "kid@example.com", deleted: true });
    const { rewrites } = planChoreAssigneeRewrites([chore()], members([gone]));
    expect(rewrites).toHaveLength(0);
  });

  it("collapses a duplicate when the uid is already in assigneeIds", () => {
    const { rewrites } = planChoreAssigneeRewrites(
      [chore({ assigneeIds: ["kid-uid", "kid@example.com"] })],
      members([KID]),
    );
    expect(rewrites[0]?.nextAssigneeIds).toEqual(["kid-uid"]);
  });

  it("leaves non-email entries in assigneeIds untouched", () => {
    const sibling = member({ memberId: "sib-uid", uid: "sib-uid", email: "sib@example.com" });
    const { rewrites } = planChoreAssigneeRewrites(
      [chore({ assigneeId: "sib-uid", assigneeIds: ["sib-uid", "kid@example.com"] })],
      members([KID, sibling]),
    );
    expect(rewrites[0]?.nextAssigneeIds).toEqual(["sib-uid", "kid-uid"]);
    expect(rewrites[0]?.changedFields).toEqual(["assigneeIds"]);
  });

  it("rewrites the resolvable half of a mixed chore and skips the rest", () => {
    const { rewrites, skips } = planChoreAssigneeRewrites(
      [chore({ assigneeId: "kid@example.com", assigneeIds: ["kid@example.com", "pending@example.com"] })],
      members([KID]),
    );
    expect(rewrites[0]?.nextAssigneeIds).toEqual(["kid-uid", "pending@example.com"]);
    expect(skips[0]).toMatchObject({ email: "pending@example.com", reason: "no_uid_keyed_member" });
  });

  it("matches case-insensitively", () => {
    const { rewrites } = planChoreAssigneeRewrites(
      [chore({ assigneeId: "KID@Example.com", assigneeIds: ["KID@Example.com"] })],
      members([member({ memberId: "kid-uid", uid: "kid-uid", email: "kid@EXAMPLE.com" })]),
    );
    expect(rewrites[0]?.nextAssigneeId).toBe("kid-uid");
  });

  it("skips non-live chores under the default live scope, and includes them under all", () => {
    const done = chore({ status: "Approved" });
    const live = planChoreAssigneeRewrites([done], members([KID]), "live");
    expect(live.rewrites).toHaveLength(0);
    expect(live.skips[0]).toMatchObject({ reason: "out_of_scope" });

    const all = planChoreAssigneeRewrites([done], members([KID]), "all");
    expect(all.rewrites).toHaveLength(1);
    expect(all.skips).toHaveLength(0);
  });

  it("produces nothing for a chore that is already uid-keyed", () => {
    const { rewrites, skips } = planChoreAssigneeRewrites(
      [chore({ assigneeId: "kid-uid", assigneeIds: ["kid-uid"] })],
      members([KID]),
    );
    expect(rewrites).toHaveLength(0);
    expect(skips).toHaveLength(0);
  });
});
