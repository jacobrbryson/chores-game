/**
 * Rewrites email-valued chore assignee references (`assigneeId`,
 * `assigneeIds[]`) to the member's uid — Phase 2 step 2 of
 * `docs/release/sign-in-with-apple.md`.
 *
 * Safety model (same shape as the inviteLookup cleanup):
 *  - DRY RUN BY DEFAULT. `--apply` is required.
 *  - The plan is re-derived from live data every run; no stored list.
 *  - A reference is rewritten only when EXACTLY ONE non-deleted, uid-keyed
 *    member of that family carries the email. Ambiguity or absence is a skip.
 *  - `--expect <n>` aborts on drift between the audit and the rewrite.
 *  - An immutable audit record is written BEFORE each patch; an audit failure
 *    means the patch does not happen.
 *  - Previous field values are captured in a receipt file for restore.
 *  - Only `assigneeId`/`assigneeIds` are written (via updateMask). `updatedAt`
 *    is deliberately NOT bumped: this is a storage-format migration, not a
 *    family edit, and bumping it would reorder chore lists for real users.
 *
 * Run it:
 *   npm run migration:rewrite-chore-assignees                       # dry run, live chores
 *   npm run migration:rewrite-chore-assignees -- --apply --expect 10 --actor you@example.com
 *   npm run migration:rewrite-chore-assignees -- --scope all        # include Approved/Deleted
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  adminPatchDocument,
  adminRunQueryAllInCollectionGroup,
} from "@/lib/firestore/admin";
import { writeAdminAuditLog } from "@/lib/audit/log";
import {
  documentIdFromName,
  readBoolean,
  readString,
  readStringArray,
  stringArrayField,
  stringField,
} from "@/lib/firestore/rest";
import { redactEmail } from "@/lib/migration/email-keying-audit";
import {
  countEmailRefs,
  planChoreAssigneeRewrites,
  type ChoreAssigneeRecord,
  type RewriteScope,
} from "@/lib/migration/chore-assignee-rewrite";
import type { MemberRecord } from "@/lib/migration/email-keying-types";

const AUDIT_EVENT = "chore_assignee_email_rewritten";
const CAP = 200_000;

type Options = {
  apply: boolean;
  expect: number | null;
  actor: string;
  out: string;
  scope: RewriteScope;
  includeEmails: boolean;
};

function parseOptions(argv: string[]): Options {
  const options: Options = {
    apply: false,
    expect: null,
    actor: "",
    out: path.join(".dry-run", "chore-assignee-rewrite"),
    scope: "live",
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
    else if (arg === "--scope") {
      const value = next();
      if (value !== "live" && value !== "all") {
        throw new Error(`--scope must be "live" or "all", got "${value}"`);
      }
      options.scope = value;
    } else throw new Error(`Unknown argument: ${arg}`);
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
    `[rewrite] mode: ${options.apply ? "APPLY (documents will be written)" : "DRY RUN (nothing written)"} | scope: ${options.scope}`,
  );
  const show = (email: string) => (options.includeEmails ? email : redactEmail(email));

  const [memberScan, choreScan] = await Promise.all([
    adminRunQueryAllInCollectionGroup("members", { cap: CAP }),
    adminRunQueryAllInCollectionGroup("chores", { cap: CAP }),
  ]);
  if (memberScan.truncated || choreScan.truncated) {
    throw new Error("SCAN_TRUNCATED: refusing to plan a rewrite against a partial read.");
  }

  const membersByFamily = new Map<string, MemberRecord[]>();
  for (const doc of memberScan.documents) {
    const segments = segmentsOf(doc.name);
    if (segments[0] !== "families" || segments[2] !== "members") continue;
    const familyId = segments[1] ?? "";
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

  const { rewrites, skips } = planChoreAssigneeRewrites(chores, membersByFamily, options.scope);
  const refsTotal = countEmailRefs(chores);
  const refsRewritten = rewrites.reduce(
    (total, rewrite) =>
      total +
      [rewrite.previousAssigneeId, ...rewrite.previousAssigneeIds].filter((value) =>
        rewrite.mappings.some((mapping) => mapping.email === value.trim().toLowerCase()),
      ).length,
    0,
  );

  console.log(`[rewrite] chores scanned:            ${chores.length}`);
  console.log(`[rewrite] email refs in all chores:  ${refsTotal}`);
  console.log(`[rewrite] chores to rewrite:         ${rewrites.length}`);
  console.log(`[rewrite] refs to rewrite:           ${refsRewritten}`);
  console.log(`[rewrite] skipped refs:              ${skips.length}`);
  console.log("");
  for (const rewrite of rewrites) {
    const mapped = rewrite.mappings
      .map((mapping) => `${show(mapping.email)} -> ${mapping.uid}`)
      .join(", ");
    console.log(
      `  REWRITE ${rewrite.familyId.slice(0, 8)} ${rewrite.choreId.slice(0, 8)} [${rewrite.status}] ${rewrite.changedFields.join("+")}  ${mapped}`,
    );
  }
  for (const skip of skips.filter((entry) => entry.reason !== "out_of_scope")) {
    console.log(
      `  SKIP    ${skip.familyId.slice(0, 8)} ${skip.choreId.slice(0, 8)} [${skip.status}] ${show(skip.email)}  (${skip.reason})`,
    );
  }
  const outOfScope = skips.filter((entry) => entry.reason === "out_of_scope").length;
  if (outOfScope > 0) {
    console.log(`  (${outOfScope} ref(s) on non-live chores skipped — re-run with --scope all)`);
  }
  console.log("");

  if (options.expect !== null && refsRewritten !== options.expect) {
    throw new Error(
      `EXPECTATION_MISMATCH: expected ${options.expect} ref(s) to rewrite, planned ${refsRewritten}. ` +
        `Data changed since the audit — re-run the dry run and review before applying.`,
    );
  }

  const receipt = {
    ranAt: new Date().toISOString(),
    applied: options.apply,
    scope: options.scope,
    actor: options.actor,
    choresRewritten: rewrites.length,
    refsRewritten,
    rewrites: rewrites.map((rewrite) => ({
      path: `families/${rewrite.familyId}/chores/${rewrite.choreId}`,
      status: rewrite.status,
      changedFields: rewrite.changedFields,
      previous: {
        assigneeId: rewrite.previousAssigneeId,
        assigneeIds: rewrite.previousAssigneeIds,
      },
      next: { assigneeId: rewrite.nextAssigneeId, assigneeIds: rewrite.nextAssigneeIds },
    })),
    skipped: skips.map((skip) => ({
      ...skip,
      email: options.includeEmails ? skip.email : redactEmail(skip.email),
    })),
  };

  if (!options.apply) {
    console.log("[rewrite] DRY RUN — nothing written. Re-run with --apply to write.");
  }

  for (const rewrite of rewrites) {
    if (!options.apply) continue;
    const docPath = `families/${rewrite.familyId}/chores/${rewrite.choreId}`;

    // Audit first: an unaudited mutation of family data is not acceptable.
    await writeAdminAuditLog({
      familyId: rewrite.familyId,
      eventType: AUDIT_EVENT,
      actor: { email: options.actor, name: "rewrite-email-chore-assignees", role: "system" },
      choreId: rewrite.choreId,
      userId: rewrite.mappings[0]?.uid ?? "",
      source: "scripts/rewrite-email-chore-assignees",
      reason:
        "Email-keyed assignee reference rewritten to the member uid so chore completion no longer depends on request.auth.token.email.",
      previous: {
        assigneeId: rewrite.previousAssigneeId,
        assigneeIds: rewrite.previousAssigneeIds.join(","),
      },
      next: {
        assigneeId: rewrite.nextAssigneeId,
        assigneeIds: rewrite.nextAssigneeIds.join(","),
      },
    });

    const fields: Record<string, ReturnType<typeof stringField>> = {};
    const updateMask: string[] = [];
    if (rewrite.changedFields.includes("assigneeId")) {
      fields.assigneeId = stringField(rewrite.nextAssigneeId);
      updateMask.push("assigneeId");
    }
    if (rewrite.changedFields.includes("assigneeIds")) {
      fields.assigneeIds = stringArrayField(rewrite.nextAssigneeIds);
      updateMask.push("assigneeIds");
    }
    await adminPatchDocument(docPath, fields, updateMask);
    console.log(
      `[rewrite] patched ${rewrite.familyId.slice(0, 8)}/${rewrite.choreId.slice(0, 8)} (${updateMask.join(", ")})`,
    );
  }

  await mkdir(path.dirname(path.resolve(options.out)), { recursive: true });
  const receiptPath = `${path.resolve(options.out)}.json`;
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log("");
  console.log(`[rewrite] receipt (previous values for restore): ${receiptPath}`);
  console.log(
    options.apply
      ? `[rewrite] done — ${rewrites.length} chore(s), ${refsRewritten} ref(s) rewritten.`
      : `[rewrite] done — would rewrite ${rewrites.length} chore(s), ${refsRewritten} ref(s).`,
  );
}

main().catch((error: unknown) => {
  console.error(
    "[REWRITE_CHORE_ASSIGNEES_ERROR]",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
