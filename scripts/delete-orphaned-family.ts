/**
 * Removes the leftover data of a family whose `families/{familyId}` document no
 * longer exists, while preserving the immutable privacy/consent and audit trail.
 *
 * Safety model:
 *  - DRY RUN BY DEFAULT. `--apply` is required.
 *  - `--family <id>` is REQUIRED. There is no default target, so this can never
 *    be pointed at a live family by accident.
 *  - It REFUSES to run if `families/{familyId}` exists. The premise of this
 *    script is that the parent document is missing; a family that has been
 *    restored must go through the product's own staged deletion flow instead
 *    (CLAUDE.md: deletion schedules 30 days out, it is never immediate).
 *  - `consentEvents` and `auditLogs` are RETAINED. AGENTS.md classifies consent
 *    history and audit records as ADMIN_ONLY immutable records, and CLAUDE.md
 *    requires audit logs for privacy and consent changes. Deleting them to tidy
 *    up an abandoned family would destroy exactly the record that proves what
 *    happened.
 *  - `--expect <n>` aborts if the document count drifts from what was reviewed.
 *  - Audit records are written BEFORE any delete; an audit failure aborts.
 *  - Full contents of every deleted document go to a receipt file for restore.
 *
 * Run it:
 *   npm run migration:delete-orphaned-family -- --family <id>
 *   npm run migration:delete-orphaned-family -- --family <id> --apply --expect 17 --actor you@example.com
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  adminDeleteDocument,
  adminGetDocument,
  adminListAllDocuments,
  adminListCollectionIds,
  adminPatchDocument,
} from "@/lib/firestore/admin";
import { writeAdminAuditLog } from "@/lib/audit/log";
import {
  documentIdFromName,
  readString,
  readStringArray,
  stringArrayField,
} from "@/lib/firestore/rest";
import { redactEmail } from "@/lib/migration/email-keying-audit";

/** Never deleted: the immutable privacy/consent and audit trail. */
const RETAINED_COLLECTIONS = new Set(["consentEvents", "auditLogs"]);
const CAP = 20_000;

type Options = {
  familyId: string;
  apply: boolean;
  expect: number | null;
  actor: string;
  out: string;
};

function parseOptions(argv: string[]): Options {
  const options: Options = {
    familyId: "",
    apply: false,
    expect: null,
    actor: "",
    out: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index] ?? "";
    if (arg === "--family") options.familyId = next();
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--expect") options.expect = Number(next());
    else if (arg === "--actor") options.actor = next();
    else if (arg === "--out") options.out = next();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.familyId) {
    throw new Error("--family <familyId> is required. This script has no default target.");
  }
  if (options.expect !== null && !Number.isFinite(options.expect)) {
    throw new Error("--expect requires a number");
  }
  if (!options.out) {
    options.out = path.join(".dry-run", `orphaned-family-${options.familyId.slice(0, 8)}`);
  }
  return options;
}

async function familyDocumentExists(familyId: string) {
  try {
    await adminGetDocument(`families/${familyId}`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("FIRESTORE_ADMIN_HTTP_404")) return false;
    throw error;
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const { familyId } = options;
  console.log(
    `[orphan] mode: ${options.apply ? "APPLY (documents will be deleted)" : "DRY RUN (nothing written)"}`,
  );
  console.log(`[orphan] target family: ${familyId}`);

  if (await familyDocumentExists(familyId)) {
    throw new Error(
      `FAMILY_DOCUMENT_EXISTS: families/${familyId} is present. This script only removes leftovers ` +
        `of a family whose parent document is missing. Use the product's staged deletion flow instead.`,
    );
  }
  console.log(`[orphan] confirmed families/${familyId} does not exist`);

  const collectionIds = await adminListCollectionIds(`families/${familyId}`);
  const toDelete: Array<{ path: string; collectionId: string; fields: unknown }> = [];
  const retained: Array<{ collectionId: string; count: number }> = [];
  const perCollection: Record<string, number> = {};

  for (const collectionId of collectionIds.sort()) {
    const docs = await adminListAllDocuments(`families/${familyId}/${collectionId}`, {
      cap: CAP,
      pageSize: 300,
    });
    if (RETAINED_COLLECTIONS.has(collectionId)) {
      retained.push({ collectionId, count: docs.length });
      continue;
    }
    perCollection[collectionId] = docs.length;
    for (const doc of docs) {
      toDelete.push({
        path: `families/${familyId}/${collectionId}/${documentIdFromName(doc.name)}`,
        collectionId,
        fields: doc.fields ?? {},
      });
    }
  }

  // inviteLookup records pointing at this family are part of the leftover set.
  const lookups = await adminListAllDocuments("inviteLookup", { cap: CAP, pageSize: 300 });
  const orphanLookups = lookups.filter(
    (doc) => readString(doc.fields, "familyId") === familyId,
  );
  for (const doc of orphanLookups) {
    toDelete.push({
      path: `inviteLookup/${documentIdFromName(doc.name)}`,
      collectionId: "inviteLookup",
      fields: doc.fields ?? {},
    });
  }
  perCollection.inviteLookup = orphanLookups.length;

  // Users whose only membership is this family would otherwise be left pointing
  // at data that no longer exists — the exact stranded-user state the audit
  // reports on. Clear the reference rather than leaving a dangling one.
  const users = await adminListAllDocuments("users", { cap: CAP, pageSize: 300 });
  const affectedUsers = users
    .map((doc) => ({
      uid: documentIdFromName(doc.name),
      email: readString(doc.fields, "email"),
      familyIds: readStringArray(doc.fields, "familyIds"),
    }))
    .filter((user) => user.familyIds.includes(familyId));

  console.log("");
  console.log("[orphan] to delete:");
  for (const [collectionId, count] of Object.entries(perCollection).sort()) {
    if (count > 0) console.log(`    ${collectionId.padEnd(20)} ${count}`);
  }
  console.log(`    ${"TOTAL".padEnd(20)} ${toDelete.length}`);
  console.log("[orphan] retained (immutable trail):");
  for (const entry of retained) {
    console.log(`    ${entry.collectionId.padEnd(20)} ${entry.count}`);
  }
  console.log("[orphan] users to update:");
  for (const user of affectedUsers) {
    const nextIds = user.familyIds.filter((id) => id !== familyId);
    console.log(
      `    ${user.uid} ${user.email ? redactEmail(user.email) : "(no email)"} ${JSON.stringify(user.familyIds)} -> ${JSON.stringify(nextIds)}`,
    );
  }
  console.log("");

  if (options.expect !== null && toDelete.length !== options.expect) {
    throw new Error(
      `EXPECTATION_MISMATCH: expected ${options.expect} document(s) to delete, found ${toDelete.length}. ` +
        `Re-run the dry run and review before applying.`,
    );
  }

  const receipt = {
    ranAt: new Date().toISOString(),
    applied: options.apply,
    familyId,
    actor: options.actor,
    retained,
    deletedCount: toDelete.length,
    deleted: toDelete,
    usersUpdated: affectedUsers.map((user) => ({
      uid: user.uid,
      previousFamilyIds: user.familyIds,
      nextFamilyIds: user.familyIds.filter((id) => id !== familyId),
    })),
  };

  if (!options.apply) {
    console.log("[orphan] DRY RUN — nothing deleted. Re-run with --apply to delete.");
  } else {
    // Audit first, into the auditLogs subcollection this script retains, so the
    // record of the removal lives alongside the record of what was removed.
    await writeAdminAuditLog({
      familyId,
      eventType: "orphaned_family_data_purged",
      actor: { email: options.actor, name: "delete-orphaned-family", role: "system" },
      source: "scripts/delete-orphaned-family",
      reason:
        "families/{familyId} document is missing; leftover subcollection data removed. consentEvents and auditLogs retained.",
      previous: {
        ...Object.fromEntries(Object.entries(perCollection).map(([key, value]) => [key, value])),
        totalDeleted: toDelete.length,
      },
      next: {
        retainedConsentEvents: retained.find((r) => r.collectionId === "consentEvents")?.count ?? 0,
        retainedAuditLogs: retained.find((r) => r.collectionId === "auditLogs")?.count ?? 0,
      },
    });

    for (const entry of toDelete) {
      await adminDeleteDocument(entry.path);
      console.log(`[orphan] deleted ${entry.path}`);
    }

    for (const user of affectedUsers) {
      const nextIds = user.familyIds.filter((id) => id !== familyId);
      await writeAdminAuditLog({
        familyId,
        eventType: "user_family_reference_cleared",
        actor: { email: options.actor, name: "delete-orphaned-family", role: "system" },
        userId: user.uid,
        source: "scripts/delete-orphaned-family",
        reason: "Family data purged; removing the dangling familyIds reference.",
        previous: { familyIds: user.familyIds.join(",") },
        next: { familyIds: nextIds.join(",") },
      });
      await adminPatchDocument(`users/${user.uid}`, { familyIds: stringArrayField(nextIds) }, [
        "familyIds",
      ]);
      console.log(`[orphan] updated users/${user.uid} familyIds -> ${JSON.stringify(nextIds)}`);
    }
  }

  await mkdir(path.dirname(path.resolve(options.out)), { recursive: true });
  const receiptPath = `${path.resolve(options.out)}.json`;
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log("");
  console.log(`[orphan] receipt (full contents of every deleted doc): ${receiptPath}`);
  console.log(
    options.apply
      ? `[orphan] done — ${toDelete.length} deleted, ${affectedUsers.length} user(s) updated, ${retained.reduce((sum, r) => sum + r.count, 0)} retained.`
      : `[orphan] done — would delete ${toDelete.length}, update ${affectedUsers.length} user(s), retain ${retained.reduce((sum, r) => sum + r.count, 0)}.`,
  );
}

main().catch((error: unknown) => {
  console.error(
    "[DELETE_ORPHANED_FAMILY_ERROR]",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
