import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, updateDoc, Timestamp, type Firestore } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  ADMIN_EMAIL,
  ADMIN_UID,
  authed,
  CHILD_EMAIL,
  CHILD_UID,
  createRulesTestEnvironment,
  FAMILY_A,
  INVITED_EMAIL,
  INVITED_UID,
  OUTSIDER_EMAIL,
  OUTSIDER_UID,
  RELAY_EMAIL,
  RELAY_UID,
  seedBaseline,
  seedChore,
  seedMember,
} from "./helpers";

function completionPayload() {
  return {
    status: "Submitted",
    submittedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };
}

/**
 * Pins chore-completion authorization AFTER the email-keying migration.
 *
 * `assigneeId`/`assigneeIds` are uid-keyed: the email-matching branches
 * (`assigneeId == request.auth.token.email.lower()` and
 * `assigneeIds.hasAny([...email...])`) were removed once every email-valued
 * assignee reference had been rewritten. An address in an assignee field now
 * authorizes nobody, which is the point — it means a Hide My Email user's relay
 * address cannot decide whether they may complete a chore.
 */
describe("firestore.rules — chore completion", () => {
  let env: RulesTestEnvironment;

  beforeAll(async () => {
    env = await createRulesTestEnvironment();
  });

  afterAll(async () => {
    await env?.cleanup();
  });

  beforeEach(async () => {
    await env.clearFirestore();
    await seedBaseline(env);
  });

  async function seed(chore: Parameters<typeof seedChore>[1]) {
    await env.withSecurityRulesDisabled(async (context) => {
      await seedChore(context.firestore() as unknown as Firestore, chore);
    });
  }

  it("lets the uid-keyed assignee submit their own open chore", async () => {
    await seed({ familyId: FAMILY_A, choreId: "c1", assigneeId: CHILD_UID });
    const db = authed(env, CHILD_UID, CHILD_EMAIL);
    await assertSucceeds(updateDoc(doc(db, `families/${FAMILY_A}/chores/c1`), completionPayload()));
  });

  // Was allowed before the migration. An email in assigneeId now matches nobody:
  // the migration rewrote every live reference to a uid, so anything still
  // holding an address is stale data, not an identity.
  it("denies submitting via an assigneeId that holds an email address", async () => {
    await seed({ familyId: FAMILY_A, choreId: "c2", assigneeId: INVITED_EMAIL });
    const db = authed(env, INVITED_UID, INVITED_EMAIL);
    await assertFails(updateDoc(doc(db, `families/${FAMILY_A}/chores/c2`), completionPayload()));
  });

  it("denies submitting via an assigneeIds entry that holds an email address", async () => {
    await seed({
      familyId: FAMILY_A,
      choreId: "c3",
      assigneeId: "someone-else",
      assigneeIds: ["someone-else", INVITED_EMAIL],
    });
    const db = authed(env, INVITED_UID, INVITED_EMAIL);
    await assertFails(updateDoc(doc(db, `families/${FAMILY_A}/chores/c3`), completionPayload()));
  });

  it("lets the assignee submit once the reference has been rewritten to their uid", async () => {
    // The same person as above, after scripts/rewrite-email-chore-assignees.ts
    // replaced the address with their uid and they hold a uid-keyed member doc.
    await env.withSecurityRulesDisabled(async (context) => {
      await seedMember(context.firestore() as unknown as Firestore, {
        familyId: FAMILY_A,
        memberId: INVITED_UID,
        uid: INVITED_UID,
        email: INVITED_EMAIL,
        status: "active",
      });
    });
    await seed({ familyId: FAMILY_A, choreId: "c3b", assigneeId: INVITED_UID });
    const db = authed(env, INVITED_UID, INVITED_EMAIL);
    await assertSucceeds(updateDoc(doc(db, `families/${FAMILY_A}/chores/c3b`), completionPayload()));
  });

  it("lets any family member complete a family-scoped chore", async () => {
    await seed({
      familyId: FAMILY_A,
      choreId: "c4",
      assigneeId: "",
      assigneeIds: [],
      assigneeScope: "family",
    });
    const db = authed(env, CHILD_UID, CHILD_EMAIL);
    await assertSucceeds(updateDoc(doc(db, `families/${FAMILY_A}/chores/c4`), completionPayload()));
  });

  it("denies a family member completing a chore assigned to someone else", async () => {
    await seed({ familyId: FAMILY_A, choreId: "c5", assigneeId: ADMIN_UID });
    const db = authed(env, CHILD_UID, CHILD_EMAIL);
    await assertFails(updateDoc(doc(db, `families/${FAMILY_A}/chores/c5`), completionPayload()));
  });

  it("denies a member of another family completing the chore", async () => {
    await seed({ familyId: FAMILY_A, choreId: "c6", assigneeId: CHILD_UID });
    const db = authed(env, OUTSIDER_UID, OUTSIDER_EMAIL);
    await assertFails(updateDoc(doc(db, `families/${FAMILY_A}/chores/c6`), completionPayload()));
    await assertFails(getDoc(doc(db, `families/${FAMILY_A}/chores/c6`)));
  });

  it("denies the assignee changing fields beyond the completion set", async () => {
    await seed({ familyId: FAMILY_A, choreId: "c7", assigneeId: CHILD_UID });
    const db = authed(env, CHILD_UID, CHILD_EMAIL);
    await assertFails(
      updateDoc(doc(db, `families/${FAMILY_A}/chores/c7`), {
        ...completionPayload(),
        coinValue: 500,
      }),
    );
  });

  it("denies the assignee jumping straight to Approved when approval is required", async () => {
    await seed({
      familyId: FAMILY_A,
      choreId: "c8",
      assigneeId: CHILD_UID,
      requireApproval: true,
    });
    const db = authed(env, CHILD_UID, CHILD_EMAIL);
    await assertFails(
      updateDoc(doc(db, `families/${FAMILY_A}/chores/c8`), {
        status: "Approved",
        submittedAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("lets the assignee self-approve when the chore does not require approval", async () => {
    await seed({
      familyId: FAMILY_A,
      choreId: "c9",
      assigneeId: CHILD_UID,
      requireApproval: false,
    });
    const db = authed(env, CHILD_UID, CHILD_EMAIL);
    await assertSucceeds(
      updateDoc(doc(db, `families/${FAMILY_A}/chores/c9`), {
        status: "Approved",
        submittedAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }),
    );
  });

  it("denies a player deleting a chore", async () => {
    await seed({ familyId: FAMILY_A, choreId: "c10", assigneeId: CHILD_UID });
    const db = authed(env, CHILD_UID, CHILD_EMAIL);
    await assertFails(
      updateDoc(doc(db, `families/${FAMILY_A}/chores/c10`), { deleted: true, updatedAt: Timestamp.now() }),
    );
  });

  it("lets a family admin update any chore in their family", async () => {
    await seed({ familyId: FAMILY_A, choreId: "c11", assigneeId: CHILD_UID });
    const db = authed(env, ADMIN_UID, ADMIN_EMAIL);
    await assertSucceeds(
      updateDoc(doc(db, `families/${FAMILY_A}/chores/c11`), {
        status: "Approved",
        updatedAt: Timestamp.now(),
      }),
    );
  });

  // The Hide My Email case, after the fix.
  //
  // Before the migration this was denied because the relay address did not
  // match the invited address — the user was locked out by their own privacy
  // choice, with no way through. It is still denied while they hold no
  // membership, but now for the ordinary reason that anyone with no member doc
  // is denied. The difference that matters is the test below it: once
  // redemption has written their uid-keyed member doc, the relay address is
  // irrelevant and they can complete their chore.
  it("denies a private-relay sign-in with no membership, like any non-member", async () => {
    await seed({ familyId: FAMILY_A, choreId: "c12", assigneeId: INVITED_EMAIL });
    const db = authed(env, RELAY_UID, RELAY_EMAIL);
    await assertFails(updateDoc(doc(db, `families/${FAMILY_A}/chores/c12`), completionPayload()));
  });

  it("lets a private-relay user complete their chore once they have joined by invite code", async () => {
    // What POST /api/family/invitations/redeem writes: a uid-keyed member doc,
    // with admin credentials, comparing no addresses. The chore is assigned to
    // the same uid.
    await env.withSecurityRulesDisabled(async (context) => {
      await seedMember(context.firestore() as unknown as Firestore, {
        familyId: FAMILY_A,
        memberId: RELAY_UID,
        uid: RELAY_UID,
        email: RELAY_EMAIL,
        status: "active",
      });
    });
    await seed({ familyId: FAMILY_A, choreId: "c13", assigneeId: RELAY_UID });
    const db = authed(env, RELAY_UID, RELAY_EMAIL);
    await assertSucceeds(updateDoc(doc(db, `families/${FAMILY_A}/chores/c13`), completionPayload()));
  });
});
