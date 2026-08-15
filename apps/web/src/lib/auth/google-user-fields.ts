import type { SessionUser } from "./session";
import { buildIdpUserAuthFields } from "./idp-user-fields";
import type { FirestoreValue } from "@/lib/firestore/rest";

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
  return buildIdpUserAuthFields({
    uid,
    role,
    locale,
    email,
    displayName,
    photoUrl,
    provider: "google",
    familyId,
    now,
  });
}
