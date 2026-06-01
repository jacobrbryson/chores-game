import { randomUUID } from "node:crypto";
import {
  boolField,
  createOrReplaceDocument,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import { DEFAULT_LOCALE } from "@/lib/locale";
import { seedStarterContent } from "@/lib/family/starter-content";

type CreateFamilyForUserInput = {
  uid: string;
  userName: string;
  userEmail: string;
  idToken: string;
};

export async function createFamilyForUser({
  uid,
  userName,
  userEmail,
  idToken,
}: CreateFamilyForUserInput) {
  const familyId = randomUUID();
  const now = new Date().toISOString();

  await createOrReplaceDocument(
    `families/${familyId}`,
    {
      name: stringField(`${userName || "My"} Family`),
      defaultLocale: stringField(DEFAULT_LOCALE),
      createdBy: stringField(uid),
      createdAt: timestampField(now),
    },
    idToken,
  );

  await createOrReplaceDocument(
    `families/${familyId}/members/${uid}`,
    {
      name: stringField(userName || "Parent"),
      email: stringField(userEmail),
      role: stringField("admin"),
      locale: stringField(DEFAULT_LOCALE),
      status: stringField("active"),
      deleted: boolField(false),
      uid: stringField(uid),
      createdAt: timestampField(now),
      lastSignInAt: timestampField(now),
    },
    idToken,
  );

  // NOTE: we intentionally do NOT write the `users/{uid}` document here.
  // For brand-new users that doc does not exist yet, and the hardened Firestore
  // rules (`isValidSelfUserCreate`) reject a partial create — which previously
  // failed sign-in with FIRESTORE_HTTP_403. Each caller is responsible for
  // persisting the user doc with a complete, rules-valid shape:
  //   - Google auth routes write the full `authFields` user doc right after this.
  //   - The family members route relinks `familyIds` onto the existing admin doc.

  // Best-effort starter content so the new family lands on a live dashboard.
  // A seeding failure must never block sign-in / family creation.
  try {
    await seedStarterContent({ familyId, uid, userName, idToken });
  } catch (error) {
    console.error("[BOOTSTRAP] starter content seeding failed", error);
  }

  return familyId;
}
