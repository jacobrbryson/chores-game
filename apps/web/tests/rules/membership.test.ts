import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, Timestamp, type Firestore } from "firebase/firestore";
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
  seedMember,
} from "./helpers";

/**
 * Pins membership authorization AFTER the email-keying migration.
 *
 * Membership resolves by uid only. `memberDocPathByEmail`, `hasEmailMemberDoc`,
 * `hasClaimableEmailInvite`, and the `isFamilyAdmin` email branch are gone, so
 * `request.auth.token.email` no longer grants anything — which is what makes
 * Hide My Email safe. Invitees join through the invite-code flow, which writes
 * membership uid-keyed with admin credentials and compares no addresses.
 */
describe("firestore.rules — family membership", () => {
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

  it("lets a uid-keyed member read their family", async () => {
    const db = authed(env, CHILD_UID, CHILD_EMAIL);
    await assertSucceeds(getDoc(doc(db, `families/${FAMILY_A}`)));
  });

  // Was allowed before the migration. An email-keyed member doc no longer
  // confers membership: only members/{uid} does. This is the single behavioral
  // change with real blast radius, which is why every email-keyed doc was
  // migrated or expired before the rules were touched.
  it("denies a member whose only record is an email-keyed doc", async () => {
    const db = authed(env, INVITED_UID, INVITED_EMAIL);
    await assertFails(getDoc(doc(db, `families/${FAMILY_A}`)));
  });

  it("denies a signed-in user with no membership in the family", async () => {
    const db = authed(env, "nobody-uid", "nobody@example.com");
    await assertFails(getDoc(doc(db, `families/${FAMILY_A}`)));
  });

  it("denies cross-family reads of family documents", async () => {
    const db = authed(env, OUTSIDER_UID, OUTSIDER_EMAIL);
    await assertFails(getDoc(doc(db, `families/${FAMILY_A}`)));
    await assertFails(getDoc(doc(db, `families/${FAMILY_A}/members/${CHILD_UID}`)));
  });

  it("denies cross-family reads even for a family admin of another family", async () => {
    // OUTSIDER_UID is an admin — of family B. Admin role must not leak across
    // family boundaries.
    const db = authed(env, OUTSIDER_UID, OUTSIDER_EMAIL);
    await assertFails(
      setDoc(
        doc(db, `families/${FAMILY_A}/members/new-member`),
        { name: "Intruder", email: "", uid: "", role: "player", status: "active", deleted: false },
      ),
    );
  });

  it("denies a soft-deleted member", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), `families/${FAMILY_A}/members/${CHILD_UID}`),
        { deleted: true },
        { merge: true },
      );
    });
    const db = authed(env, CHILD_UID, CHILD_EMAIL);
    await assertFails(getDoc(doc(db, `families/${FAMILY_A}`)));
  });

  it("lets a family admin add a member", async () => {
    const db = authed(env, ADMIN_UID, ADMIN_EMAIL);
    await assertSucceeds(
      setDoc(doc(db, `families/${FAMILY_A}/members/added@example.com`), {
        name: "Added",
        email: "added@example.com",
        uid: "",
        role: "player",
        status: "invited",
        deleted: false,
        createdAt: Timestamp.now(),
      }),
    );
  });

  it("denies a player adding a member", async () => {
    const db = authed(env, CHILD_UID, CHILD_EMAIL);
    await assertFails(
      setDoc(doc(db, `families/${FAMILY_A}/members/added@example.com`), {
        name: "Added",
        email: "added@example.com",
        uid: "",
        role: "player",
        status: "invited",
        deleted: false,
        createdAt: Timestamp.now(),
      }),
    );
  });

  describe("claiming an invite", () => {
    // Was allowed before the migration, via hasClaimableEmailInvite. The
    // email-invite claim path is gone: a client can no longer promote itself
    // into a family by proving its token email matches a members/{email} doc.
    // Joining now goes through POST /api/family/invitations/redeem, which
    // validates a single-use code and writes membership with admin credentials.
    it("denies self-claiming an email invite from the client", async () => {
      const db = authed(env, INVITED_UID, INVITED_EMAIL);
      await assertFails(
        setDoc(doc(db, `families/${FAMILY_A}/members/${INVITED_UID}`), {
          name: "Invited",
          email: INVITED_EMAIL,
          uid: INVITED_UID,
          role: "player",
          status: "active",
          deleted: false,
          createdAt: Timestamp.now(),
        }),
      );
    });

    it("denies escalating the invited role to admin while claiming", async () => {
      const db = authed(env, INVITED_UID, INVITED_EMAIL);
      await assertFails(
        setDoc(doc(db, `families/${FAMILY_A}/members/${INVITED_UID}`), {
          name: "Invited",
          email: INVITED_EMAIL,
          uid: INVITED_UID,
          role: "admin",
          status: "active",
          deleted: false,
          createdAt: Timestamp.now(),
        }),
      );
    });

    it("denies claiming someone else's invite", async () => {
      const db = authed(env, "attacker-uid", "attacker@example.com");
      await assertFails(
        setDoc(doc(db, `families/${FAMILY_A}/members/${INVITED_UID}`), {
          name: "Invited",
          email: INVITED_EMAIL,
          uid: "attacker-uid",
          role: "player",
          status: "active",
          deleted: false,
          createdAt: Timestamp.now(),
        }),
      );
    });

    // The uid-keyed claim path is untouched: an invite created directly against
    // someone's uid can still be activated by that person.
    it("still lets a uid-keyed invitee activate their own member doc", async () => {
      await env.withSecurityRulesDisabled(async (context) => {
        await seedMember(context.firestore() as unknown as Firestore, {
          familyId: FAMILY_A,
          memberId: INVITED_UID,
          uid: INVITED_UID,
          email: INVITED_EMAIL,
          status: "invited",
        });
      });
      const db = authed(env, INVITED_UID, INVITED_EMAIL);
      await assertSucceeds(
        setDoc(doc(db, `families/${FAMILY_A}/members/${INVITED_UID}`), {
          name: "Invited",
          email: INVITED_EMAIL,
          uid: INVITED_UID,
          role: "player",
          status: "active",
          deleted: false,
          createdAt: Timestamp.now(),
        }),
      );
    });

    // The Hide My Email case, after the fix. Still denied while they hold no
    // membership — the ordinary non-member outcome — but no longer denied
    // BECAUSE of the relay address, which is the difference that matters.
    it("denies a private-relay sign-in with no membership, like any non-member", async () => {
      const db = authed(env, RELAY_UID, RELAY_EMAIL);
      await assertFails(getDoc(doc(db, `families/${FAMILY_A}`)));
      await assertFails(
        setDoc(doc(db, `families/${FAMILY_A}/members/${RELAY_UID}`), {
          name: "Invited",
          email: RELAY_EMAIL,
          uid: RELAY_UID,
          role: "player",
          status: "active",
          deleted: false,
          createdAt: Timestamp.now(),
        }),
      );
    });

    it("gives a private-relay user full access once redemption writes their uid member doc", async () => {
      await env.withSecurityRulesDisabled(async (context) => {
        await seedMember(context.firestore() as unknown as Firestore, {
          familyId: FAMILY_A,
          memberId: RELAY_UID,
          uid: RELAY_UID,
          email: RELAY_EMAIL,
          status: "active",
        });
      });
      const db = authed(env, RELAY_UID, RELAY_EMAIL);
      await assertSucceeds(getDoc(doc(db, `families/${FAMILY_A}`)));
      await assertSucceeds(getDoc(doc(db, `families/${FAMILY_A}/members/${CHILD_UID}`)));
    });
  });

  describe("inviteLookup", () => {
    // Was allowed before the migration. Nothing reads inviteLookup any more, so
    // the read rule is `if false` rather than gated on request.auth.token.email.
    it("denies reading the invite lookup keyed to your own email", async () => {
      const db = authed(env, INVITED_UID, INVITED_EMAIL);
      await assertFails(getDoc(doc(db, `inviteLookup/${INVITED_EMAIL}`)));
    });

    it("denies reading an invite lookup for another address", async () => {
      const db = authed(env, RELAY_UID, RELAY_EMAIL);
      await assertFails(getDoc(doc(db, `inviteLookup/${INVITED_EMAIL}`)));
    });

    it("denies a non-admin writing an invite lookup", async () => {
      const db = authed(env, CHILD_UID, CHILD_EMAIL);
      await assertFails(
        setDoc(doc(db, `inviteLookup/target@example.com`), {
          email: "target@example.com",
          familyId: FAMILY_A,
          role: "player",
          status: "invited",
        }),
      );
    });
  });

  describe("users/{uid}", () => {
    it("lets a user read their own record", async () => {
      const db = authed(env, CHILD_UID, CHILD_EMAIL);
      await assertSucceeds(getDoc(doc(db, `users/${CHILD_UID}`)));
    });

    it("denies reading another family's user record", async () => {
      const db = authed(env, OUTSIDER_UID, OUTSIDER_EMAIL);
      await assertFails(getDoc(doc(db, `users/${CHILD_UID}`)));
    });
  });

  it("denies access to the catch-all deny rule", async () => {
    const db = authed(env, ADMIN_UID, ADMIN_EMAIL);
    await assertFails(getDoc(doc(db, "analyticsEvents/anything")));
    await assertFails(getDoc(doc(db, "operationMetrics/anything")));
  });
});
