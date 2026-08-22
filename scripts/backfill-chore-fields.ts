/**
 * Backfills the chore fields that block server-side filtering: `deleted` and
 * `status` (and optionally `createdAt`).
 *
 * Why this exists
 * ---------------
 * `/api/chores` reads the ENTIRE family chore archive on every request and
 * filters in JS. Measured in production: 5 Firestore calls but **1523 documents**
 * materialised to return a 2KB response, ~80% of the request spent parsing and
 * mapping documents that are immediately discarded.
 *
 * The route cannot simply add `where deleted == false` because Firestore
 * excludes documents that lack the field entirely, which would silently hide
 * legacy chores — see the comment on `listFamilyChoreDocuments` in
 * `apps/web/src/app/api/chores/route.ts`. Backfilling the field on every chore is
 * the prerequisite that makes the filtered query safe.
 *
 * Safety model (mirrors scripts/rewrite-email-chore-assignees.ts)
 * --------------------------------------------------------------
 *  - DRY RUN BY DEFAULT. `--apply` is required to write anything.
 *  - The plan is re-derived from live data every run; no stored list.
 *  - `--expect <n>` aborts on drift between the dry run and the apply.
 *  - Refuses to plan against a truncated scan.
 *  - An audit record is written per family BEFORE that family's writes; an audit
 *    failure means the writes for that family do not happen.
 *  - A receipt file records every document touched and the fields added, so the
 *    change can be reviewed or reversed.
 *  - Writes ONLY the missing fields, via updateMask. `updatedAt` is deliberately
 *    NOT bumped: this is a storage-format backfill, not a family edit, and
 *    bumping it would reorder chore lists for real users.
 *
 * Values written are exactly what the current readers already infer for a
 * missing field, so this is behaviour-preserving:
 *  - `deleted`  -> false      (`readBoolean` returns false when absent)
 *  - `status`   -> "Open"     (`readString(...) || "Open"`)
 *  - `createdAt`-> the document's own Firestore `createTime`
 *
 * `createdAt` is OPT-IN (`--include-created-at`) because it is the one field
 * where backfilling changes visible behaviour: chores missing it currently sort
 * as epoch 0 (oldest) via `compareBySortOrderOrOldest`, and after the backfill
 * they sort by real creation time. That is a correction, but it is a reordering
 * real users can see, so it is a separate decision from the perf fix. Only
 * `deleted` and `status` are needed to unblock the filtered query.
 *
 * Run it:
 *   npm run migration:backfill-chore-fields                       # dry run, all families
 *   npm run migration:backfill-chore-fields -- --family <familyId>
 *   npm run migration:backfill-chore-fields -- --apply --expect 1473 --actor you@example.com
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { adminCommitWrites, adminRunQueryAllInCollectionGroup } from "@/lib/firestore/admin";
import { writeAdminAuditLog } from "@/lib/audit/log";
import {
  boolField,
  documentIdFromName,
  stringField,
  timestampField,
  type FirestoreValue,
} from "@/lib/firestore/rest";

const AUDIT_EVENT = "chore_fields_backfilled";
const CAP = 200_000;
// Firestore caps a commit at 500 writes.
const COMMIT_BATCH_SIZE = 400;

type BackfillField = "deleted" | "status" | "createdAt";

type PlannedDoc = {
  familyId: string;
  choreId: string;
  missing: BackfillField[];
  createTime: string;
};

type Options = {
  apply: boolean;
  expect: number | null;
  actor: string;
  out: string;
  familyId: string;
  includeCreatedAt: boolean;
};

function parseOptions(argv: string[]): Options {
  const options: Options = {
    apply: false,
    expect: null,
    actor: "",
    out: path.join(".dry-run", "backfill-chore-fields"),
    familyId: "",
    includeCreatedAt: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index] ?? "";
    if (arg === "--apply") options.apply = true;
    else if (arg === "--expect") options.expect = Number(next());
    else if (arg === "--actor") options.actor = next();
    else if (arg === "--out") options.out = next();
    else if (arg === "--family") options.familyId = next();
    else if (arg === "--include-created-at") options.includeCreatedAt = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.expect !== null && !Number.isFinite(options.expect)) {
    throw new Error("--expect requires a number");
  }
  if (options.apply && !options.actor) {
    throw new Error("--apply requires --actor <email> for the audit record");
  }
  return options;
}

function segmentsOf(name: string) {
  return (name.split("/documents/")[1] ?? "").split("/");
}

/** A field counts as present only when the document actually carries the key. */
function hasField(fields: Record<string, FirestoreValue> | undefined, key: string) {
  return Boolean(fields && Object.prototype.hasOwnProperty.call(fields, key));
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const targetFields: BackfillField[] = options.includeCreatedAt
    ? ["deleted", "status", "createdAt"]
    : ["deleted", "status"];

  console.log(
    `[backfill] mode: ${options.apply ? "APPLY (documents will be written)" : "DRY RUN (nothing written)"}`,
  );
  console.log(`[backfill] fields: ${targetFields.join(", ")}`);
  console.log(`[backfill] scope:  ${options.familyId || "all families"}`);
  console.log("");

  const scan = await adminRunQueryAllInCollectionGroup("chores", { cap: CAP });
  if (scan.truncated) {
    throw new Error("SCAN_TRUNCATED: refusing to plan a backfill against a partial read.");
  }

  let scanned = 0;
  const missingCounts: Record<BackfillField, number> = { deleted: 0, status: 0, createdAt: 0 };
  const planned: PlannedDoc[] = [];
  const familiesSeen = new Set<string>();

  for (const doc of scan.documents) {
    const segments = segmentsOf(doc.name);
    if (segments[0] !== "families" || segments[2] !== "chores") continue;
    const familyId = segments[1] ?? "";
    if (options.familyId && familyId !== options.familyId) continue;
    scanned += 1;
    familiesSeen.add(familyId);

    const missing = targetFields.filter((field) => !hasField(doc.fields, field));
    // Count every absent field for the report, even ones not being written.
    for (const field of ["deleted", "status", "createdAt"] as BackfillField[]) {
      if (!hasField(doc.fields, field)) missingCounts[field] += 1;
    }
    if (missing.length === 0) continue;
    planned.push({
      familyId,
      choreId: documentIdFromName(doc.name),
      missing,
      createTime: doc.createTime ?? "",
    });
  }

  console.log(`[backfill] chore documents scanned:   ${scanned}`);
  console.log(`[backfill] families in scope:         ${familiesSeen.size}`);
  console.log(`[backfill] missing 'deleted':         ${missingCounts.deleted}`);
  console.log(`[backfill] missing 'status':          ${missingCounts.status}`);
  console.log(
    `[backfill] missing 'createdAt':       ${missingCounts.createdAt}${options.includeCreatedAt ? "" : "  (not written — pass --include-created-at)"}`,
  );
  console.log(`[backfill] documents to write:        ${planned.length}`);
  console.log("");

  const byFamily = new Map<string, PlannedDoc[]>();
  for (const entry of planned) {
    const bucket = byFamily.get(entry.familyId) ?? [];
    bucket.push(entry);
    byFamily.set(entry.familyId, bucket);
  }
  for (const [familyId, entries] of byFamily) {
    const perField = targetFields
      .map((field) => `${field}:${entries.filter((e) => e.missing.includes(field)).length}`)
      .join(" ");
    console.log(`  ${familyId.slice(0, 8)}  ${String(entries.length).padStart(6)} doc(s)   ${perField}`);
  }
  console.log("");

  if (options.expect !== null && planned.length !== options.expect) {
    throw new Error(
      `EXPECTATION_MISMATCH: expected ${options.expect} document(s) to write, planned ${planned.length}. ` +
        `Data changed since the dry run — re-run the dry run and review before applying.`,
    );
  }

  const receipt = {
    ranAt: new Date().toISOString(),
    applied: options.apply,
    actor: options.actor,
    fields: targetFields,
    familyId: options.familyId || null,
    scanned,
    missingCounts,
    documentsWritten: planned.length,
    documents: planned.map((entry) => ({
      path: `families/${entry.familyId}/chores/${entry.choreId}`,
      added: entry.missing,
      createTime: entry.createTime,
    })),
  };
  await mkdir(options.out, { recursive: true });
  const receiptPath = path.join(options.out, "receipt.json");
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(`[backfill] receipt written: ${receiptPath}`);

  if (!options.apply) {
    console.log("[backfill] DRY RUN — nothing written. Re-run with --apply to write.");
    console.log(
      `[backfill] when you apply, pass --expect ${planned.length} so drift aborts the run.`,
    );
    return;
  }

  let written = 0;
  for (const [familyId, entries] of byFamily) {
    // Audit first: an unaudited mutation of family data is not acceptable. One
    // record per family rather than per document — the absent fields already
    // read as these exact values, so this is a storage-format change, and 1500
    // per-document entries would bury the family's real audit history.
    await writeAdminAuditLog({
      familyId,
      eventType: AUDIT_EVENT,
      actor: { email: options.actor, name: "backfill-chore-fields", role: "system" },
      source: "scripts/backfill-chore-fields",
      reason:
        "Backfilled absent chore fields to the values the readers already inferred, so chore queries can filter server-side instead of reading the whole archive.",
      previous: { documentsMissingFields: String(entries.length) },
      next: { fieldsAdded: targetFields.join(","), documentsWritten: String(entries.length) },
    });

    for (let index = 0; index < entries.length; index += COMMIT_BATCH_SIZE) {
      const batch = entries.slice(index, index + COMMIT_BATCH_SIZE);
      await adminCommitWrites(
        batch.map((entry) => {
          const fields: Record<string, FirestoreValue> = {};
          const updateMask: string[] = [];
          if (entry.missing.includes("deleted")) {
            fields.deleted = boolField(false);
            updateMask.push("deleted");
          }
          if (entry.missing.includes("status")) {
            fields.status = stringField("Open");
            updateMask.push("status");
          }
          if (entry.missing.includes("createdAt") && entry.createTime) {
            fields.createdAt = timestampField(entry.createTime);
            updateMask.push("createdAt");
          }
          return {
            update: {
              path: `families/${entry.familyId}/chores/${entry.choreId}`,
              fields,
              updateMask,
              // Refuse to resurrect a document deleted since the scan.
              currentDocument: { exists: true },
            },
          };
        }),
      );
      written += batch.length;
      console.log(`[backfill] ${familyId.slice(0, 8)}  wrote ${written}/${planned.length}`);
    }
  }

  console.log("");
  console.log(`[backfill] APPLIED — ${written} document(s) written.`);
  console.log("[backfill] re-run the dry run; it should now report 0 documents to write.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
