import type { SessionUser } from "./session";
import {
  stringArrayField,
  stringField,
  timestampField,
  type FirestoreValue,
} from "@/lib/firestore/rest";

type BuildGoogleUserAuthFieldsInput = {
  uid: string;
  role: SessionUser["role"];
  locale: string;
  email: string;
  displayName: string;
  photoUrl: string;
  familyId?: string;
  now: string;
};

/**
 * Builds the self-service Google auth fields accepted by
 * `isValidSelfUserCreate` / `isValidSelfUserUpdate` in firestore.rules.
 */
export function buildGoogleUserAuthFields({
  uid,
  role,
  locale,
  email,
  displayName,
  photoUrl,
  familyId = "",
  now,
}: BuildGoogleUserAuthFieldsInput): Record<string, FirestoreValue> {
  return {
    uid: stringField(uid),
    role: stringField(role),
    locale: stringField(locale),
    email: stringField(email),
    displayName: stringField(displayName),
    photoUrl: stringField(photoUrl),
    provider: stringField("google"),
    lastSignInAt: timestampField(now),
    ...(familyId
      ? {
          familyIds: stringArrayField([familyId]),
          lastFamilyUpdateAt: timestampField(now),
        }
      : {}),
  };
}
