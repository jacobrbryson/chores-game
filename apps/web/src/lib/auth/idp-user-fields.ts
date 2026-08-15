import type { SessionUser } from "./session";
import {
  stringArrayField,
  stringField,
  timestampField,
  type FirestoreValue,
} from "@/lib/firestore/rest";

export type AuthProvider = "google" | "apple";

export type BuildIdpUserAuthFieldsInput = {
  uid: string;
  role: SessionUser["role"];
  locale: string;
  email: string;
  displayName: string;
  photoUrl: string;
  provider: AuthProvider;
  familyId?: string;
  now: string;
};

/** Builds the self-service identity-provider fields allowed by Firestore rules. */
export function buildIdpUserAuthFields({
  uid,
  role,
  locale,
  email,
  displayName,
  photoUrl,
  provider,
  familyId = "",
  now,
}: BuildIdpUserAuthFieldsInput): Record<string, FirestoreValue> {
  return {
    uid: stringField(uid),
    role: stringField(role),
    locale: stringField(locale),
    email: stringField(email),
    displayName: stringField(displayName),
    photoUrl: stringField(photoUrl),
    provider: stringField(provider),
    lastSignInAt: timestampField(now),
    ...(familyId
      ? {
          familyIds: stringArrayField([familyId]),
          lastFamilyUpdateAt: timestampField(now),
        }
      : {}),
  };
}
