/**
 * Deletes `inviteLookup/{email}` index documents left behind by invites that
 * were already accepted.
 *
 * Safety model:
 *  - DRY RUN BY DEFAULT. `--apply` is required to delete anything.
 *  - The orphan set is re-derived from live data on every run. There is no
 *    hardcoded list, so a stale report can never drive a delete.
 *  - Deletion requires an `active`, non-deleted, uid-keyed member doc carrying
 *    the same email in the same family. The membership therefore survives the
 *    delete; only the redundant index is removed.
 *  - `--expect <n>` aborts if the orphan count differs from what the operator
 *    expects, so data drifting between the audit and the cleanup is caught.
 *  - An immutable audit record is written BEFORE each delete. If the audit
 *    write fails, the delete does not happen.
 *  - Every deleted document's full contents are written to a receipt file so
 *    the change can be reversed.
 *
 * Run it:
 *   npm run migration:cleanup-invite-lookups                    # dry run
 *   npm run migration:cleanup-invite-lookups -- --apply --expect 5 --actor you@example.com
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  adminDeleteDocument,
  adminListAllDocuments,
  adminRunQueryAllInCollectionGroup,
} from "@/lib/firestore/admin";
import { writeAdminAuditLog } from "@/lib/audit/log";
import { documentIdFromName, readBoolean, readString } from "@/lib/firestore/rest";
import { redactEmail } from "@/lib/migration/email-keying-audit";
import {
  classifyInviteLookups,
  type FamilyExistence,
  type InviteLookupRow,
} from "@/lib/migration/invite-lookup-orphans";
import type { MemberRecord } from "@/lib/migration/email-keying-types";

const AUDIT_EVENT = "invite_lookup_orphan_deleted";
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
    out: path.join(".dry-run", "invite-lookup-cleanup"),
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

function familyIdFromMemberName(name: string) {
  const relative = name.split("/documents/")[1] ?? "";
  const segments = relative.split("/");
  return segments[0] === "families" && segments[2] === "members" ? (segments[1] ?? "") : "";
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const mode = options.apply ? "APPLY (documents will be deleted)" : "DRY RUN (nothing written)";
  console.log(`[cleanup] mode: ${mode}`);

  const show = (email: string) => (options.includeEmails ? email : redactEmail(email));

  const [lookupDocs, familyDocs, memberScan] = await Promise.all([
    adminListAllDocuments("inviteLookup", { cap: CAP, pageSize: 300 }),
    adminListAllDocuments("families", { cap: CAP, pageSize: 300 }),
    adminRunQueryAllInCollectionGroup("members", { cap: CAP }),
  ]);
  if (memberScan.truncated) {
    throw new Error("MEMBER_SCAN_TRUNCATED: refusing to classify against a partial member list.");
  }

  const families = new Map<string, FamilyExistence>(
    familyDocs.map((doc) => {
      const familyId = documentIdFromName(doc.name);
      return [
        familyId,
        { familyId, exists: true, deleted: readBoolean(doc.fields, "deleted") },
      ] as const;
    }),
  );

  const membersByFamily = new Map<string, MemberRecord[]>();
  for (const doc of memberScan.documents) {
    const familyId = familyIdFromMemberName(doc.name);
    if (!familyId) continue;
    const record: MemberRecord = {
      familyId,
      memberId: documentIdFromName(doc.name),
      email: readString(doc.fields, "email"),
      uid: readString(doc.fields, "uid"),
      name: readString(doc.fields, "name"),
      status: readString(doc.fields, "status"),
      role: readString(doc.fields, "role"),
      deleted: readBoolean(doc.fields, "deleted"),
      createdAt: readString(doc.fields, "createdAt"),
    };
    const bucket = membersByFamily.get(familyId) ?? [];
    bucket.push(record);
    membersByFamily.set(familyId, bucket);
  }

  const rows: InviteLookupRow[] = lookupDocs.map((doc) => ({
    docId: documentIdFromName(doc.name),
    email: readString(doc.fields, "email"),
    familyId: readString(doc.fields, "familyId"),
    status: readString(doc.fields, "status"),
  }));
  const docsById = new Map(lookupDocs.map((doc) => [documentIdFromName(doc.name), doc]));

  const verdicts = classifyInviteLookups(rows, families, membersByFamily);
  const orphans = verdicts.filter((verdict) => verdict.orphan);
  const kept = verdicts.filter((verdict) => !verdict.orphan);

  console.log(`[cleanup] inviteLookup documents: ${rows.length}`);
  console.log(`[cleanup] orphans to delete:      ${orphans.length}`);
  console.log(`[cleanup] left alone:             ${kept.length}`);
  console.log("");
  for (const verdict of verdicts) {
    const label = verdict.orphan
      ? `DELETE  (accepted as ${verdict.acceptedMemberId})`
      : `keep    (${verdict.reason})`;
    console.log(`  ${show(verdict.docId).padEnd(30)} ${verdict.familyId.slice(0, 8)}  ${label}`);
  }
  console.log("");

  if (options.expect !== null && orphans.length !== options.expect) {
    throw new Error(
      `EXPECTATION_MISMATCH: expected ${options.expect} orphan(s), found ${orphans.length}. ` +
        `Data changed since the audit — re-run the dry run and review before applying.`,
    );
  }

  const receipt = {
    ranAt: new Date().toISOString(),
    applied: options.apply,
    actor: options.actor,
    orphanCount: orphans.length,
    deleted: [] as Array<{ path: string; familyId: string; fields: unknown }>,
    kept: kept.map((verdict) => ({
      docId: options.includeEmails ? verdict.docId : redactEmail(verdict.docId),
      familyId: verdict.familyId,
      reason: verdict.reason,
    })),
  };

  if (!options.apply) {
    console.log("[cleanup] DRY RUN — nothing deleted. Re-run with --apply to delete.");
  }

  for (const verdict of orphans) {
    if (!verdict.orphan) continue;
    const doc = docsById.get(verdict.docId);
    const docPath = `inviteLookup/${verdict.docId}`;
    const snapshot = {
      path: docPath,
      familyId: verdict.familyId,
      fields: doc?.fields ?? {},
    };
    receipt.deleted.push(snapshot);

    if (!options.apply) continue;

    // Audit first. If this throws, the delete below never runs — an unaudited
    // deletion of family data is not acceptable (see AGENTS.md, Support Access).
    await writeAdminAuditLog({
      familyId: verdict.familyId,
      eventType: AUDIT_EVENT,
      actor: { email: options.actor, name: "cleanup-orphaned-invite-lookups", role: "system" },
      userId: verdict.acceptedMemberId,
      source: "scripts/cleanup-orphaned-invite-lookups",
      reason:
        "Invite already accepted: no members/{email} doc remains and an active uid-keyed member doc carries this address.",
      previous: {
        documentPath: docPath,
        email: readString(doc?.fields, "email"),
        familyId: readString(doc?.fields, "familyId"),
        status: readString(doc?.fields, "status"),
      },
      next: { deleted: true },
    });

    await adminDeleteDocument(docPath);
    console.log(`[cleanup] deleted ${show(verdict.docId)} (${verdict.familyId.slice(0, 8)})`);
  }

  await mkdir(path.dirname(path.resolve(options.out)), { recursive: true });
  const receiptPath = `${path.resolve(options.out)}.json`;
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log("");
  console.log(`[cleanup] receipt (restorable document contents): ${receiptPath}`);
  console.log(
    options.apply
      ? `[cleanup] done — ${receipt.deleted.length} document(s) deleted, ${kept.length} left alone.`
      : `[cleanup] done — would delete ${receipt.deleted.length}, leave ${kept.length}.`,
  );
}

main().catch((error: unknown) => {
  console.error(
    "[CLEANUP_INVITE_LOOKUPS_ERROR]",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
