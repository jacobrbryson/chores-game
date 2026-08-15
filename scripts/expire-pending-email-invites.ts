/**
 * Expires unredeemed email-keyed invitations and cleans up the chores that were
 * assigned to those people — Phase 2 step 1 of the migration, done the way the
 * product itself does it rather than by hard deleting.
 *
 * What it writes, mirroring the app's own routes exactly:
 *  - `members/{email}`      -> `deleted: true`, `deletedAt`
 *                              (as `DELETE /api/family/members/{memberId}`)
 *  - `inviteLookup/{email}` -> `status: "revoked"`, `updatedAt` (same route)
 *  - chore (only assignee)  -> `deleted: true`, `deletedAt`, `status: "Deleted"`,
 *                              `updatedAt` (as `DELETE /api/chores/{choreId}`)
 *  - chore (shared)         -> the expired assignee is dropped, chore survives
 *
 * This ends the migration exposure — `hasEmailMemberDoc()` in firestore.rules
 * requires `deleted != true`, and the sign-in cascade ignores a `revoked`
 * inviteLookup — while staying reversible, which a hard delete of a live
 * invitation in someone else's family would not be.
 *
 * Safety model matches the other migration scripts: dry run by default,
 * `--expect` drift guard, audit-before-write, full restore receipt.
 *
 * Run it:
 *   npm run migration:expire-pending-invites
 *   npm run migration:expire-pending-invites -- --apply --expect 5 --actor you@example.com
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  adminPatchDocument,
  adminRunQueryAllInCollectionGroup,
  adminListAllDocuments,
  adminCreateOrReplaceDocument,
} from "@/lib/firestore/admin";
import { writeAdminAuditLog } from "@/lib/audit/log";
import {
  boolField,
  documentIdFromName,
  readBoolean,
  readString,
  readStringArray,
  stringArrayField,
  stringField,
  timestampField,
  type FirestoreValue,
} from "@/lib/firestore/rest";
import { keyableEmail } from "@/lib/auth/private-relay";
import { redactEmail } from "@/lib/migration/email-keying-audit";
import { planPendingInviteExpiry } from "@/lib/migration/pending-invite-expiry";
import type { ChoreAssigneeRecord } from "@/lib/migration/chore-assignee-rewrite";
import type { MemberRecord } from "@/lib/migration/email-keying-types";

const CAP = 200_000;

type Options = {
  apply: boolean;
  expect: number | null;
  actor: string;
  out: string;
  includeEmails: boolean;
};

function parseOptions(argv: string[]): Options {
  const options: Options = {
    apply: false,
    expect: null,
    actor: "",
    out: path.join(".dry-run", "pending-invite-expiry"),
    includeEmails: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index] ?? "";
    if (arg === "--apply") options.apply = true;
    else if (arg === "--expect") options.expect = Number(next());
    else if (arg === "--actor") options.actor = next();
    else if (arg === "--out") options.out = next();
    else if (arg === "--include-emails") options.includeEmails = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.expect !== null && !Number.isFinite(options.expect)) {
    throw new Error("--expect requires a number");
  }
  return options;
}

function segmentsOf(name: string) {
  return (name.split("/documents/")[1] ?? "").split("/");
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  console.log(
    `[expire] mode: ${options.apply ? "APPLY (documents will be written)" : "DRY RUN (nothing written)"}`,
  );
  const show = (email: string) => (options.includeEmails ? email : redactEmail(email));

  const [memberScan, choreScan, lookupDocs] = await Promise.all([
    adminRunQueryAllInCollectionGroup("members", { cap: CAP }),
    adminRunQueryAllInCollectionGroup("chores", { cap: CAP }),
    adminListAllDocuments("inviteLookup", { cap: CAP, pageSize: 300 }),
  ]);
  if (memberScan.truncated || choreScan.truncated) {
    throw new Error("SCAN_TRUNCATED: refusing to plan against a partial read.");
  }

  const members: MemberRecord[] = [];
  for (const doc of memberScan.documents) {
    const segments = segmentsOf(doc.name);
    if (segments[0] !== "families" || segments[2] !== "members") continue;
    members.push({
      familyId: segments[1] ?? "",
      memberId: documentIdFromName(doc.name),
      email: readString(doc.fields, "email"),
      uid: readString(doc.fields, "uid"),
      name: readString(doc.fields, "name"),
      status: readString(doc.fields, "status"),
      role: readString(doc.fields, "role"),
      deleted: readBoolean(doc.fields, "deleted"),
      createdAt: readString(doc.fields, "createdAt"),
    });
  }

  const chores: ChoreAssigneeRecord[] = [];
  for (const doc of choreScan.documents) {
    const segments = segmentsOf(doc.name);
    if (segments[0] !== "families" || segments[2] !== "chores") continue;
    chores.push({
      familyId: segments[1] ?? "",
      choreId: documentIdFromName(doc.name),
      status: readString(doc.fields, "status"),
      deleted: readBoolean(doc.fields, "deleted"),
      assigneeId: readString(doc.fields, "assigneeId"),
      assigneeIds: readStringArray(doc.fields, "assigneeIds"),
    });
  }

  const { expiries, skips, choreActions } = planPendingInviteExpiry({ members, chores });
  const lookupByEmail = new Map(
    lookupDocs.map((doc) => [documentIdFromName(doc.name).toLowerCase(), doc] as const),
  );

  console.log(`[expire] invitations to expire: ${expiries.length}`);
  for (const expiry of expiries) {
    const hasLookup = lookupByEmail.has(expiry.memberId.toLowerCase());
    console.log(
      `    ${show(expiry.memberId).padEnd(30)} ${expiry.familyId.slice(0, 8)} status=${expiry.status} role=${expiry.role} inviteLookup=${hasLookup ? "revoke" : "none"}`,
    );
  }
  console.log(`[expire] chore actions: ${choreActions.length}`);
  for (const action of choreActions) {
    console.log(
      action.kind === "soft_delete"
        ? `    SOFT-DELETE ${action.familyId.slice(0, 8)} ${action.choreId.slice(0, 8)} [${action.status}] (only assignee expired)`
        : `    UNASSIGN    ${action.familyId.slice(0, 8)} ${action.choreId.slice(0, 8)} [${action.status}] -> ${JSON.stringify(action.nextAssigneeIds)}`,
    );
  }
  if (skips.length > 0) {
    console.log(`[expire] skipped: ${skips.length}`);
    for (const skip of skips) {
      console.log(`    ${show(skip.memberId).padEnd(30)} ${skip.familyId.slice(0, 8)} (${skip.reason})`);
    }
  }
  console.log("");

  if (options.expect !== null && expiries.length !== options.expect) {
    throw new Error(
      `EXPECTATION_MISMATCH: expected ${options.expect} invitation(s), planned ${expiries.length}. ` +
        `Re-run the dry run and review before applying.`,
    );
  }

  const now = new Date().toISOString();
  const receipt = {
    ranAt: now,
    applied: options.apply,
    actor: options.actor,
    expiries: expiries.map((expiry) => ({
      memberPath: `families/${expiry.familyId}/members/${expiry.memberId}`,
      lookupPath: lookupByEmail.has(expiry.memberId.toLowerCase())
        ? `inviteLookup/${expiry.memberId}`
        : "",
      previousLookupFields: lookupByEmail.get(expiry.memberId.toLowerCase())?.fields ?? null,
      status: expiry.status,
      role: expiry.role,
    })),
    choreActions,
    skips,
  };

  if (!options.apply) {
    console.log("[expire] DRY RUN — nothing written. Re-run with --apply to write.");
  } else {
    for (const expiry of expiries) {
      await writeAdminAuditLog({
        familyId: expiry.familyId,
        eventType: "invite_expired",
        actor: { email: options.actor, name: "expire-pending-email-invites", role: "system" },
        source: "scripts/expire-pending-email-invites",
        reason:
          "Unredeemed email-keyed invitation expired during the email-keying migration. Re-invite through the invite-code flow.",
        previous: { memberId: expiry.memberId, status: expiry.status, deleted: false },
        next: { deleted: true, inviteLookupStatus: "revoked" },
      });

      await adminPatchDocument(
        `families/${expiry.familyId}/members/${expiry.memberId}`,
        { deleted: boolField(true), deletedAt: timestampField(now) },
        ["deleted", "deletedAt"],
      );

      // Same shape the revoke route writes: the lookup record is kept, with a
      // status the sign-in cascade will not match.
      const lookupEmail = keyableEmail(expiry.memberId);
      if (lookupEmail && lookupByEmail.has(lookupEmail)) {
        await adminCreateOrReplaceDocument(`inviteLookup/${lookupEmail}`, {
          email: stringField(lookupEmail),
          familyId: stringField(expiry.familyId),
          status: stringField("revoked"),
          updatedAt: timestampField(now),
        });
      }
      console.log(`[expire] expired ${show(expiry.memberId)} (${expiry.familyId.slice(0, 8)})`);
    }

    for (const action of choreActions) {
      await writeAdminAuditLog({
        familyId: action.familyId,
        eventType: "chore_status_changed",
        actor: { email: options.actor, name: "expire-pending-email-invites", role: "system" },
        choreId: action.choreId,
        source: "scripts/expire-pending-email-invites",
        reason:
          action.kind === "soft_delete"
            ? "Chore deleted: its only assignee was an unredeemed invitation that has been expired."
            : "Expired invitee removed from a shared chore's assignees.",
        previous:
          action.kind === "soft_delete"
            ? { status: action.status, deleted: false }
            : {
                assigneeId: action.previousAssigneeId,
                assigneeIds: action.previousAssigneeIds.join(","),
              },
        next:
          action.kind === "soft_delete"
            ? { status: "Deleted", deleted: true }
            : {
                assigneeId: action.nextAssigneeId,
                assigneeIds: action.nextAssigneeIds.join(","),
              },
      });

      const docPath = `families/${action.familyId}/chores/${action.choreId}`;
      if (action.kind === "soft_delete") {
        await adminPatchDocument(
          docPath,
          {
            deleted: boolField(true),
            deletedAt: timestampField(now),
            status: stringField("Deleted"),
            updatedAt: timestampField(now),
          },
          ["deleted", "deletedAt", "status", "updatedAt"],
        );
        console.log(`[expire] soft-deleted chore ${action.choreId.slice(0, 8)}`);
      } else {
        const fields: Record<string, FirestoreValue> = {
          assigneeId: stringField(action.nextAssigneeId),
          assigneeIds: stringArrayField(action.nextAssigneeIds),
          updatedAt: timestampField(now),
        };
        await adminPatchDocument(docPath, fields, ["assigneeId", "assigneeIds", "updatedAt"]);
        console.log(`[expire] unassigned chore ${action.choreId.slice(0, 8)}`);
      }
    }
  }

  await mkdir(path.dirname(path.resolve(options.out)), { recursive: true });
  const receiptPath = `${path.resolve(options.out)}.json`;
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log("");
  console.log(`[expire] receipt (restore data): ${receiptPath}`);
  console.log(
    options.apply
      ? `[expire] done — ${expiries.length} invitation(s) expired, ${choreActions.length} chore action(s).`
      : `[expire] done — would expire ${expiries.length}, apply ${choreActions.length} chore action(s).`,
  );
}

main().catch((error: unknown) => {
  console.error(
    "[EXPIRE_PENDING_INVITES_ERROR]",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
