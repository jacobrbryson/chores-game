import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  throw new Error("FIREBASE_PROJECT_ID is required.");
}

const TEST_DATA = {
  familyId: process.env.E2E_FAMILY_ID ?? "e2e-family",
  parent: {
    uid: process.env.E2E_PARENT_UID ?? "e2e-parent",
    email: process.env.E2E_PARENT_EMAIL ?? "parent.test@family-chores.test",
    name: process.env.E2E_PARENT_NAME ?? "Playwright Parent",
    role: "admin",
  },
  child: {
    uid: process.env.E2E_CHILD_UID ?? "e2e-child",
    email: process.env.E2E_CHILD_EMAIL ?? "child.test@family-chores.test",
    name: process.env.E2E_CHILD_NAME ?? "Playwright Child",
    role: "player",
  },
  // Second managed player used by the Kiosk Mode roster/switch tests. No Firebase
  // auth user is required because tests never sign in directly as this child —
  // they switch into it from the parent's kiosk session.
  childTwo: {
    uid: process.env.E2E_CHILD2_UID ?? "e2e-child-2",
    email: process.env.E2E_CHILD2_EMAIL ?? "child2.test@family-chores.test",
    name: process.env.E2E_CHILD2_NAME ?? "Playwright Child Two",
    role: "player",
  },
  support: {
    uid: process.env.E2E_SUPPORT_UID ?? "e2e-support",
    email: process.env.E2E_SUPPORT_EMAIL ?? "support.test@family-chores.test",
    name: process.env.E2E_SUPPORT_NAME ?? "Playwright Support",
    role: "admin",
  },
};

function encodeBase64Url(input) {
  return Buffer.from(input).toString("base64url");
}

async function readServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim();
  if (raw) {
    return JSON.parse(raw);
  }
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (path) {
    return JSON.parse(await readFile(path, "utf8"));
  }
  throw new Error("Set FIREBASE_SERVICE_ACCOUNT_KEY or GOOGLE_APPLICATION_CREDENTIALS.");
}

async function getAdminToken() {
  const account = await readServiceAccount();
  if (!account.client_email || !account.private_key) {
    throw new Error("Firebase service account is missing client_email or private_key.");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = encodeBase64Url(
    JSON.stringify({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/datastore",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    }),
  );
  const unsignedJwt = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsignedJwt);
  signer.end();
  const assertion = `${unsignedJwt}.${signer.sign(account.private_key).toString("base64url")}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) {
    throw new Error(`SERVICE_ACCOUNT_TOKEN_HTTP_${response.status}: ${await response.text()}`);
  }
  const token = await response.json();
  return token.access_token;
}

function stringField(value) {
  return { stringValue: String(value ?? "") };
}

function integerField(value) {
  return { integerValue: String(Math.max(0, Math.floor(Number(value) || 0))) };
}

function boolField(value) {
  return { booleanValue: Boolean(value) };
}

function timestampField(value) {
  return { timestampValue: value };
}

function stringArrayField(values) {
  return { arrayValue: { values: values.map((value) => stringField(value)) } };
}

async function patchDocument(token, path, fields) {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ fields }),
    },
  );
  if (!response.ok) {
    throw new Error(`FIRESTORE_PATCH_${path}_HTTP_${response.status}: ${await response.text()}`);
  }
}

function userFields(user, familyIds = []) {
  const now = new Date().toISOString();
  return {
    uid: stringField(user.uid),
    email: stringField(user.email),
    name: stringField(user.name),
    role: stringField(user.role),
    locale: stringField("en-US"),
    familyIds: stringArrayField(familyIds),
    currentCoins: integerField(0),
    weeklyFamilyHighlightsEmail: boolField(false),
    createdAt: timestampField(now),
    updatedAt: timestampField(now),
  };
}

function memberFields(user) {
  const now = new Date().toISOString();
  return {
    uid: stringField(user.uid),
    email: stringField(user.email),
    name: stringField(user.name),
    role: stringField(user.role),
    status: stringField("active"),
    locale: stringField("en-US"),
    currentCoins: integerField(0),
    dashboardPrimaryColor: stringField(user.role === "admin" ? "#0072b2" : "#009e73"),
    deleted: boolField(false),
    createdAt: timestampField(now),
    updatedAt: timestampField(now),
  };
}

async function main() {
  const token = await getAdminToken();
  const now = new Date().toISOString();
  const { familyId, parent, child, childTwo, support } = TEST_DATA;

  await patchDocument(token, `users/${parent.uid}`, userFields(parent, [familyId]));
  await patchDocument(token, `users/${child.uid}`, userFields(child, [familyId]));
  await patchDocument(token, `users/${childTwo.uid}`, userFields(childTwo, [familyId]));
  await patchDocument(token, `users/${support.uid}`, userFields(support, []));

  await patchDocument(token, `families/${familyId}`, {
    name: stringField("Playwright Test Family"),
    createdBy: stringField(parent.uid),
    defaultLocale: stringField("en-US"),
    dataRegion: stringField("US"),
    deleted: boolField(false),
    createdAt: timestampField(now),
    updatedAt: timestampField(now),
  });

  await patchDocument(token, `families/${familyId}/members/${parent.uid}`, memberFields(parent));
  await patchDocument(token, `families/${familyId}/members/${child.uid}`, memberFields(child));
  await patchDocument(token, `families/${familyId}/members/${childTwo.uid}`, memberFields(childTwo));

  console.log(`Seeded E2E family ${familyId} (parent, ${child.name}, ${childTwo.name}).`);
  console.log("Create matching Firebase Auth users for parent/child (and support) separately and export their E2E_*_FIREBASE_ID_TOKEN values before running Playwright.");
  console.log(`${childTwo.name} is a managed kiosk player and needs no Firebase Auth user.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
