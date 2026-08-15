import { readFileSync } from "node:fs";
import path from "node:path";
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, Timestamp, type Firestore } from "firebase/firestore";

export const PROJECT_ID = "chores-game-rules-test";

export const FAMILY_A = "familyA";
export const FAMILY_B = "familyB";

export const ADMIN_UID = "admin-uid";
export const ADMIN_EMAIL = "parent@example.com";

/** A child who already accepted: has a uid-keyed member doc. */
export const CHILD_UID = "child-uid";
export const CHILD_EMAIL = "kid@example.com";

/** A child who was invited but has not accepted: only members/{email} exists. */
export const INVITED_EMAIL = "invited@example.com";
export const INVITED_UID = "invited-uid";

/** The same invited person signing in with an Apple private-relay address. */
export const RELAY_EMAIL = "x7k2p9@privaterelay.appleid.com";
export const RELAY_UID = "relay-uid";

/** A member of an unrelated family, used for cross-family denial checks. */
export const OUTSIDER_UID = "outsider-uid";
export const OUTSIDER_EMAIL = "stranger@example.com";

export async function createRulesTestEnvironment(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(path.resolve(process.cwd(), "firestore.rules"), "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
}

export function authed(env: RulesTestEnvironment, uid: string, email?: string) {
  return env.authenticatedContext(uid, email ? { email, email_verified: true } : {}).firestore();
}

type MemberSeed = {
  familyId: string;
  memberId: string;
  uid?: string;
  email?: string;
  name?: string;
  role?: "admin" | "player";
  status?: "invited" | "claimed" | "active";
  deleted?: boolean;
};

export async function seedMember(db: Firestore, member: MemberSeed) {
  await setDoc(doc(db, `families/${member.familyId}/members/${member.memberId}`), {
    name: member.name ?? "Member",
    email: member.email ?? "",
    uid: member.uid ?? "",
    role: member.role ?? "player",
    status: member.status ?? "active",
    deleted: member.deleted ?? false,
    createdAt: Timestamp.now(),
  });
}

export async function seedUser(
  db: Firestore,
  uid: string,
  familyIds: string[],
  role: "admin" | "player" = "player",
) {
  await setDoc(doc(db, `users/${uid}`), {
    uid,
    role,
    locale: "en-US",
    email: "",
    displayName: "Test user",
    photoUrl: "",
    provider: "google",
    lastSignInAt: Timestamp.now(),
    familyIds,
    lastFamilyUpdateAt: Timestamp.now(),
  });
}

type ChoreSeed = {
  familyId: string;
  choreId: string;
  assigneeId: string;
  assigneeIds?: string[];
  assigneeScope?: "single" | "family";
  status?: string;
  requireApproval?: boolean;
};

export async function seedChore(db: Firestore, chore: ChoreSeed) {
  await setDoc(doc(db, `families/${chore.familyId}/chores/${chore.choreId}`), {
    title: "Take out the trash",
    details: "",
    source: "manual",
    status: chore.status ?? "Open",
    assigneeId: chore.assigneeId,
    assigneeIds: chore.assigneeIds ?? [chore.assigneeId],
    assigneeName: "Member",
    assigneeScope: chore.assigneeScope ?? "single",
    coinValue: 5,
    requireApproval: chore.requireApproval ?? true,
    deleted: false,
    createdBy: ADMIN_UID,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
}

/**
 * Baseline fixture shared by the rules tests. It deliberately contains both
 * keying schemes at once — uid-keyed accepted members and email-keyed pending
 * invites — because that is the state real families are in today.
 */
export async function seedBaseline(env: RulesTestEnvironment) {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore() as unknown as Firestore;

    // Family A: one admin, one accepted child, one email-keyed pending invite.
    await setDoc(doc(db, `families/${FAMILY_A}`), {
      name: "Family A",
      createdBy: ADMIN_UID,
      defaultLocale: "en-US",
    });
    await seedMember(db, {
      familyId: FAMILY_A,
      memberId: ADMIN_UID,
      uid: ADMIN_UID,
      email: ADMIN_EMAIL,
      role: "admin",
      status: "active",
    });
    await seedMember(db, {
      familyId: FAMILY_A,
      memberId: CHILD_UID,
      uid: CHILD_UID,
      email: CHILD_EMAIL,
      role: "player",
      status: "active",
    });
    await seedMember(db, {
      familyId: FAMILY_A,
      memberId: INVITED_EMAIL,
      email: INVITED_EMAIL,
      role: "player",
      status: "invited",
    });
    await setDoc(doc(db, `inviteLookup/${INVITED_EMAIL}`), {
      email: INVITED_EMAIL,
      familyId: FAMILY_A,
      role: "player",
      status: "invited",
    });

    await seedUser(db, ADMIN_UID, [FAMILY_A], "admin");
    await seedUser(db, CHILD_UID, [FAMILY_A], "player");

    // Family B exists only so cross-family access can be asserted as denied.
    await setDoc(doc(db, `families/${FAMILY_B}`), {
      name: "Family B",
      createdBy: OUTSIDER_UID,
      defaultLocale: "en-US",
    });
    await seedMember(db, {
      familyId: FAMILY_B,
      memberId: OUTSIDER_UID,
      uid: OUTSIDER_UID,
      email: OUTSIDER_EMAIL,
      role: "admin",
      status: "active",
    });
    await seedUser(db, OUTSIDER_UID, [FAMILY_B], "admin");
  });
}
