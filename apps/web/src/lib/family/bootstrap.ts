import { randomUUID } from "node:crypto";
import {
  boolField,
  createOrReplaceDocument,
  patchDocument,
  stringArrayField,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";
import { DEFAULT_LOCALE } from "@/lib/locale";

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

  await patchDocument(
    `users/${uid}`,
    {
      uid: stringField(uid),
      locale: stringField(DEFAULT_LOCALE),
      familyIds: stringArrayField([familyId]),
      lastFamilyUpdateAt: timestampField(now),
    },
    idToken,
    ["familyIds", "lastFamilyUpdateAt", "locale", "uid"],
  );

  return familyId;
}
