#!/usr/bin/env node
/**
 * Seeds the Firestore EMULATOR with a fixture that contains one example of
 * every category the email-keying dry run is supposed to find, so
 * `scripts/email-keying-dry-run.ts` can be exercised end to end without touching
 * real family data.
 *
 * It refuses to run unless FIRESTORE_EMULATOR_HOST is set, and it talks only to
 * that host — it has no production code path at all.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_PROJECT_ID=<id> \
 *     node scripts/test-data/seed-email-keying-fixture.mjs
 */
const host = process.env.FIRESTORE_EMULATOR_HOST?.trim();
// `firebase emulators:exec` exports GCLOUD_PROJECT rather than FIREBASE_PROJECT_ID.
const projectId =
  process.env.FIREBASE_PROJECT_ID?.trim() ||
  process.env.GCLOUD_PROJECT?.trim() ||
  process.env.GOOGLE_CLOUD_PROJECT?.trim();
if (!host) {
  throw new Error("FIRESTORE_EMULATOR_HOST must be set. This fixture is emulator-only.");
}
if (!projectId) {
  throw new Error("FIREBASE_PROJECT_ID (or GCLOUD_PROJECT) must be set.");
}

const origin = host.startsWith("http") ? host : `http://${host}`;
const documentsUrl = `${origin}/v1/projects/${projectId}/databases/(default)/documents`;

const s = (value) => ({ stringValue: String(value ?? "") });
const b = (value) => ({ booleanValue: Boolean(value) });
const i = (value) => ({ integerValue: String(value) });
const ts = (value) => ({ timestampValue: value });
const arr = (values) => ({ arrayValue: { values: values.map((value) => s(value)) } });

const NOW = "2026-08-13T00:00:00.000Z";

async function put(path, fields) {
  const response = await fetch(`${documentsUrl}/${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
    body: JSON.stringify({ fields }),
  });
  if (!response.ok) {
    throw new Error(`SEED_${path}_HTTP_${response.status}: ${await response.text()}`);
  }
}

function family(name) {
  return { name: s(name), defaultLocale: s("en-US"), deleted: b(false), createdAt: ts(NOW) };
}

function member(overrides) {
  return {
    name: s("Member"),
    email: s(""),
    uid: s(""),
    role: s("player"),
    status: s("active"),
    deleted: b(false),
    createdAt: ts(NOW),
    ...overrides,
  };
}

function userDoc(email, familyIds, provider = "google") {
  return {
    email: s(email),
    familyIds: arr(familyIds),
    provider: s(provider),
    role: s("player"),
    createdAt: ts(NOW),
  };
}

function chore(overrides) {
  return {
    title: s("Take out the trash"),
    status: s("Open"),
    assigneeScope: s("single"),
    coinValue: i(5),
    requireApproval: b(true),
    deleted: b(false),
    createdAt: ts(NOW),
    ...overrides,
  };
}

async function main() {
  // ---- families ---------------------------------------------------------
  await put("families/famA", family("The Nguyen Family"));
  await put("families/famB", family("The Alvarez Family"));

  // ---- famA members: one of every disposition ---------------------------
  await put(
    "families/famA/members/parent-uid",
    member({ uid: s("parent-uid"), email: s("parent@example.com"), role: s("admin") }),
  );
  await put(
    "families/famA/members/kid-uid",
    member({ uid: s("kid-uid"), email: s("kid@example.com") }),
  );
  // stale orphan: both definitions agree
  await put(
    "families/famA/members/kid@example.com",
    member({ email: s("kid@example.com"), status: s("invited") }),
  );
  // migratable: users/teen-uid exists, but there is no uid-keyed member doc
  await put(
    "families/famA/members/teen@example.com",
    member({ email: s("teen@example.com"), status: s("claimed") }),
  );
  // pending invite: nobody has ever signed in under this address
  await put(
    "families/famA/members/newkid@example.com",
    member({ email: s("newkid@example.com"), status: s("invited") }),
  );
  // audit-only stale orphan: blank email field, so the Stale Invites panel is blind to it
  await put("families/famA/members/ghost@example.com", member({ status: s("invited") }));
  await put(
    "families/famA/members/ghost-uid",
    member({ uid: s("ghost-uid"), email: s("ghost@example.com") }),
  );
  // panel-only: a uid-keyed invited duplicate, outside the migration's scope
  await put(
    "families/famA/members/dup-uid",
    member({ uid: s("dup-uid"), email: s("sib@example.com"), status: s("invited") }),
  );
  await put(
    "families/famA/members/sib-uid",
    member({ uid: s("sib-uid"), email: s("sib@example.com") }),
  );
  // key and email field differ only by case
  await put(
    "families/famA/members/old@example.com",
    member({ email: s("Old@Example.com"), status: s("invited") }),
  );
  // key and email field are genuinely different addresses
  await put(
    "families/famA/members/mismatch@example.com",
    member({ email: s("renamed@example.com"), status: s("invited") }),
  );
  // an Apple private-relay address already written as a document key
  await put(
    "families/famA/members/x7k2p9@privaterelay.appleid.com",
    member({ email: s("x7k2p9@privaterelay.appleid.com"), status: s("invited") }),
  );
  // inert
  await put(
    "families/famA/members/revoked@example.com",
    member({ email: s("revoked@example.com"), status: s("revoked") }),
  );
  // a managed kiosk player with no email at all
  await put(
    "families/famA/members/kiosk-uid",
    member({ uid: s("kiosk-uid"), name: s("Kiosk Kid") }),
  );

  // ---- famB members: cross-family + stranded users ----------------------
  await put(
    "families/famB/members/parentb-uid",
    member({ uid: s("parentb-uid"), email: s("parentb@example.com"), role: s("admin") }),
  );
  // the same address keyed in a second family
  await put(
    "families/famB/members/kid@example.com",
    member({ email: s("kid@example.com"), status: s("invited") }),
  );
  // signed in, but users/stuck-uid.familyIds is empty — broken today
  await put(
    "families/famB/members/stuck@example.com",
    member({ email: s("stuck@example.com"), status: s("claimed") }),
  );
  // signed in, but familyIds points at a different family
  await put(
    "families/famB/members/wrongfam@example.com",
    member({ email: s("wrongfam@example.com"), status: s("invited") }),
  );

  // ---- users -----------------------------------------------------------
  await put("users/parent-uid", userDoc("parent@example.com", ["famA"], "google"));
  await put("users/kid-uid", userDoc("kid@example.com", ["famA"]));
  await put("users/teen-uid", userDoc("teen@example.com", ["famA"]));
  await put("users/ghost-uid", userDoc("ghost@example.com", ["famA"]));
  await put("users/dup-uid", userDoc("sib@example.com", ["famA"]));
  await put("users/sib-uid", userDoc("sib@example.com", ["famA"]));
  await put("users/parentb-uid", userDoc("parentb@example.com", ["famB"], "apple"));
  await put("users/stuck-uid", userDoc("stuck@example.com", []));
  await put("users/wrongfam-uid", userDoc("wrongfam@example.com", ["famZ"]));
  await put("users/relay-uid", userDoc("x7k2p9@privaterelay.appleid.com", [], "apple"));

  // ---- inviteLookup ----------------------------------------------------
  const lookup = (email, familyId, status) => ({
    email: s(email),
    familyId: s(familyId),
    status: s(status),
  });
  await put("inviteLookup/kid@example.com", lookup("kid@example.com", "famA", "invited"));
  await put("inviteLookup/newkid@example.com", lookup("newkid@example.com", "famA", "invited"));
  await put("inviteLookup/ghosted@example.com", lookup("ghosted@example.com", "famGone", "invited"));
  await put("inviteLookup/nomember@example.com", lookup("nomember@example.com", "famA", "claimed"));
  await put(
    "inviteLookup/x7k2p9@privaterelay.appleid.com",
    lookup("x7k2p9@privaterelay.appleid.com", "famA", "invited"),
  );

  // ---- chores: email-valued assignee references ------------------------
  await put(
    "families/famA/chores/chore-1",
    chore({ assigneeId: s("kid@example.com"), assigneeIds: arr(["kid@example.com"]) }),
  );
  await put(
    "families/famA/chores/chore-2",
    chore({ assigneeId: s("gone@example.com"), assigneeIds: arr(["gone@example.com"]) }),
  );
  await put(
    "families/famA/chores/chore-3",
    chore({
      assigneeId: s("kid-uid"),
      assigneeIds: arr(["kid-uid", "teen@example.com"]),
      assigneeScope: s("family"),
    }),
  );
  await put(
    "families/famA/chores/chore-4",
    chore({
      assigneeId: s("newkid@example.com"),
      assigneeIds: arr(["newkid@example.com"]),
      status: s("Deleted"),
      deleted: b(true),
    }),
  );
  await put(
    "families/famB/chores/chore-5",
    chore({ assigneeId: s("stuck@example.com"), assigneeIds: arr(["stuck@example.com"]) }),
  );

  // ---- routineAssignments ----------------------------------------------
  await put("families/famA/routineAssignments/ra-1", {
    routineId: s("routine-1"),
    routineName: s("Morning routine"),
    assigneeId: s("teen@example.com"),
    assigneeName: s("Teen"),
    status: s("active"),
    deleted: b(false),
    createdAt: ts(NOW),
  });

  // ---- other collections the generic sweep should surface on its own ----
  await put("families/famA/awardClaims/claim-1", {
    rewardId: s("reward-1"),
    rewardDescription: s("Movie night"),
    rewardImageId: s("popcorn"),
    coinCost: i(50),
    purchaserUid: s("kid-uid"),
    purchaserEmail: s("kid@example.com"),
    status: s("unclaimed"),
    deleted: b(false),
  });
  await put("families/famA/notifications/n-1", {
    type: s("chore_completed"),
    actorUid: s("parent-uid"),
    actorEmail: s("parent@example.com"),
    relatedIds: arr(["kid-uid", "teen@example.com"]),
    message: s("Chore completed"),
    createdAt: ts(NOW),
  });
  await put("families/famA/supportRequests/sr-1", {
    type: s("bug"),
    subject: s("Invite never arrived"),
    reporterUid: s("parent-uid"),
    reporterEmail: s("parent@example.com"),
    assignedToEmail: s("support@orcwood.com"),
    status: s("new"),
    createdAt: ts(NOW),
  });
  // third-level nesting: only found if subcollection discovery goes deep enough
  await put("families/famA/supportRequests/sr-1/internalNotes/note-1", {
    body: s("Reproduced with an email-keyed member doc"),
    authorEmail: s("operator@orcwood.com"),
    createdAt: ts(NOW),
  });
  await put("families/famA/friends/famB", {
    familyId: s("famB"),
    status: s("active"),
    invitedAdminEmail: s("parentb@example.com"),
    createdAt: ts(NOW),
  });

  // ---- familyInvites: the new token flow, for scale comparison ----------
  await put("familyInvites/inv-1", {
    familyId: s("famA"),
    familyName: s("The Nguyen Family"),
    memberId: s("newkid@example.com"),
    invitedName: s("New Kid"),
    invitedEmail: s("newkid@example.com"),
    role: s("player"),
    status: s("pending"),
    codeHash: s("0".repeat(64)),
    createdByUid: s("parent-uid"),
    createdAt: ts(NOW),
    expiresAt: ts("2026-09-12T00:00:00.000Z"),
    attemptCount: i(0),
  });

  console.log("Seeded email-keying dry-run fixture into the Firestore emulator.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
