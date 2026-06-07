export type E2ERole = "parent" | "child" | "support";

export type E2EUser = {
  uid: string;
  memberId: string;
  role: "admin" | "player";
  email: string;
  name: string;
  picture: string;
  locale: "en-US";
  firebaseIdToken: string;
  firebaseRefreshToken?: string;
};

const DEFAULTS = {
  familyId: "e2e-family",
  parentUid: "e2e-parent",
  parentEmail: "parent.test@family-chores.test",
  childUid: "e2e-child",
  childEmail: "child.test@family-chores.test",
  supportUid: "e2e-support",
  supportEmail: "support.test@family-chores.test",
};

function required(value: string | undefined) {
  return Boolean(value && value.trim().length > 0);
}

function userFor(role: E2ERole): E2EUser {
  if (role === "parent") {
    return {
      uid: process.env.E2E_PARENT_UID ?? DEFAULTS.parentUid,
      memberId: process.env.E2E_PARENT_MEMBER_ID ?? process.env.E2E_PARENT_UID ?? DEFAULTS.parentUid,
      role: "admin",
      email: process.env.E2E_PARENT_EMAIL ?? DEFAULTS.parentEmail,
      name: process.env.E2E_PARENT_NAME ?? "Playwright Parent",
      picture: process.env.E2E_PARENT_PICTURE ?? "",
      locale: "en-US",
      firebaseIdToken: process.env.E2E_PARENT_FIREBASE_ID_TOKEN ?? "",
      firebaseRefreshToken: process.env.E2E_PARENT_FIREBASE_REFRESH_TOKEN,
    };
  }
  if (role === "child") {
    return {
      uid: process.env.E2E_CHILD_UID ?? DEFAULTS.childUid,
      memberId: process.env.E2E_CHILD_MEMBER_ID ?? process.env.E2E_CHILD_UID ?? DEFAULTS.childUid,
      role: "player",
      email: process.env.E2E_CHILD_EMAIL ?? DEFAULTS.childEmail,
      name: process.env.E2E_CHILD_NAME ?? "Playwright Child",
      picture: process.env.E2E_CHILD_PICTURE ?? "",
      locale: "en-US",
      firebaseIdToken: process.env.E2E_CHILD_FIREBASE_ID_TOKEN ?? "",
      firebaseRefreshToken: process.env.E2E_CHILD_FIREBASE_REFRESH_TOKEN,
    };
  }
  return {
    uid: process.env.E2E_SUPPORT_UID ?? DEFAULTS.supportUid,
    memberId: process.env.E2E_SUPPORT_MEMBER_ID ?? process.env.E2E_SUPPORT_UID ?? DEFAULTS.supportUid,
    role: "admin",
    email: process.env.E2E_SUPPORT_EMAIL ?? DEFAULTS.supportEmail,
    name: process.env.E2E_SUPPORT_NAME ?? "Playwright Support",
    picture: process.env.E2E_SUPPORT_PICTURE ?? "",
    locale: "en-US",
    firebaseIdToken: process.env.E2E_SUPPORT_FIREBASE_ID_TOKEN ?? "",
    firebaseRefreshToken: process.env.E2E_SUPPORT_FIREBASE_REFRESH_TOKEN,
  };
}

export const E2E_TEST_DATA = {
  familyId: process.env.E2E_FAMILY_ID ?? DEFAULTS.familyId,
  parent: userFor("parent"),
  child: userFor("child"),
  support: userFor("support"),
};

export function hasE2ECredentials(...roles: E2ERole[]) {
  return roles.every((role) => required(E2E_TEST_DATA[role].firebaseIdToken));
}

export function e2eSkipReason(...roles: E2ERole[]) {
  const missing = roles.filter((role) => !required(E2E_TEST_DATA[role].firebaseIdToken));
  return missing.length
    ? `E2E credentials missing for ${missing.join(", ")}. Run scripts/test-data/seed-e2e.mjs and set the documented E2E_* token env vars.`
    : "";
}
