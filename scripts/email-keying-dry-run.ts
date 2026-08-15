/**
 * READ-ONLY dry run for the email-keying migration described in
 * `docs/release/sign-in-with-apple.md` ("Phase 2 order of operations", steps
 * 4-6).
 *
 * It writes NOTHING to Firestore. There is no write, delete, or commit call
 * anywhere in this script or in `scripts/lib/email-keying-reader.ts`; the only
 * files it creates are the two report files it is asked to produce.
 *
 * Run it:
 *   node --experimental-strip-types \
 *        --import ./scripts/lib/ts-alias-register.mjs \
 *        scripts/email-keying-dry-run.ts --out ./.dry-run/email-keying
 *
 * or, from the repo root: `npm run migration:email-keying-dry-run`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeEmailKeying, looksLikeEmail, redactEmail } from "@/lib/migration/email-keying-audit";
import { renderEmailKeyingReport } from "@/lib/migration/email-keying-report";
import { isPrivateRelayEmail, normalizeEmail } from "@/lib/auth/private-relay";
import type {
  AssigneeRefRecord,
  EmailFieldFinding,
  EmailKeyingSnapshot,
  FamilyRecord,
  InviteLookupRecord,
  MemberRecord,
  ScanCoverage,
  UserRecord,
} from "@/lib/migration/email-keying-types";
import {
  createDryRunReader,
  documentIdOf,
  familyIdFromName,
  readBooleanField,
  readStringArrayField,
  readStringField,
  relativePathFromName,
  walkStringValues,
  type DryRunReader,
  type ScanResult,
} from "./lib/email-keying-reader";

type Options = {
  out: string;
  cap: number;
  probeCap: number;
  includeEmails: boolean;
  sweep: boolean;
  skip: Set<string>;
};

const ASSIGNEE_FIELD = /^assignee(Id|Ids(\[\])?)$/;
const ASSIGNEE_COLLECTIONS = new Set(["chores", "routineAssignments"]);
/** Scanned even under --no-sweep, because the targeted sections need them. */
const REQUIRED_COLLECTIONS = new Set([
  "members",
  "inviteLookup",
  "familyInvites",
  ...ASSIGNEE_COLLECTIONS,
]);

function emptyScan(cap: number): ScanResult {
  return { documents: [], complete: true, cap };
}

/** Root-level documents from a collection-group scan (`collectionId/{docId}`). */
function topLevelDocs(result: ScanResult | undefined) {
  return (result?.documents ?? []).filter(
    (doc) => relativePathFromName(doc.name).split("/").length === 2,
  );
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    out: path.join(".dry-run", "email-keying"),
    cap: 200_000,
    probeCap: 50,
    includeEmails: false,
    sweep: true,
    skip: new Set<string>(),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index] ?? "";
    if (arg === "--out") options.out = next();
    else if (arg === "--cap") options.cap = Math.max(1, Number(next()) || options.cap);
    else if (arg === "--probe-cap") options.probeCap = Math.max(0, Number(next()) || 0);
    else if (arg === "--include-emails") options.includeEmails = true;
    else if (arg === "--no-sweep") options.sweep = false;
    else if (arg === "--skip") for (const id of next().split(",")) options.skip.add(id.trim());
    else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printUsage() {
  console.log(
    [
      "email-keying-dry-run — READ-ONLY audit of email-keyed identity records.",
      "",
      "  --out <prefix>       Output path prefix (default ./.dry-run/email-keying).",
      "                       Writes <prefix>.md and <prefix>.json.",
      "  --cap <n>            Per-collection safety cap (default 200000). The run",
      "                       FAILS rather than silently under-counting if hit.",
      "  --probe-cap <n>      Documents sampled per collection when discovering",
      "                       deeply nested subcollections (default 50).",
      "  --include-emails     Write raw addresses instead of a***@domain.",
      "                       The output then contains CHILD_SENSITIVE data.",
      "  --no-sweep           Skip the generic all-collections email sweep.",
      "  --skip <a,b>         Collection ids to skip entirely.",
    ].join("\n"),
  );
}

const log = (message: string) => console.log(`[dry-run] ${message}`);

function requireComplete(collectionId: string, result: ScanResult) {
  if (!result.complete) {
    throw new Error(
      `SCAN_TRUNCATED: "${collectionId}" hit the ${result.cap}-document cap before the cursor reached the end. ` +
        `Re-run with a larger --cap. Refusing to emit an under-counted report.`,
    );
  }
  return result;
}

/**
 * Find every collection id in the database rather than trusting a hand-written
 * list — the point of the audit is to discover email keying we did not already
 * know about.
 *
 * Root and per-family/per-user subcollections are enumerated exhaustively.
 * Third-level nesting (e.g. `supportRequests/{id}/internalNotes`) is found by
 * sampling `--probe-cap` documents per collection, which is reported honestly
 * as sampled rather than claimed as complete.
 */
async function discoverCollectionIds(
  reader: DryRunReader,
  options: Options,
  familyPaths: string[],
  userPaths: string[],
) {
  const ids = new Set<string>(await reader.listCollectionIds());
  log(`root collections: ${[...ids].sort().join(", ") || "(none)"}`);

  const parents = [...familyPaths, ...userPaths];
  for (const parent of parents) {
    for (const id of await reader.listCollectionIds(parent)) ids.add(id);
  }
  log(`after probing ${parents.length} family/user documents: ${ids.size} collection ids`);

  if (options.probeCap > 0) {
    for (const collectionId of [...ids]) {
      if (options.skip.has(collectionId)) continue;
      const sample = await reader.scanCollectionGroup(collectionId, options.probeCap);
      for (const doc of sample.documents) {
        for (const id of await reader.listCollectionIds(relativePathFromName(doc.name))) {
          ids.add(id);
        }
      }
    }
    log(`after sampling nested documents: ${ids.size} collection ids`);
  }

  for (const skipped of options.skip) ids.delete(skipped);
  return [...ids].sort();
}

function toMemberRecords(result: ScanResult): MemberRecord[] {
  return result.documents
    .filter((doc) => {
      const segments = relativePathFromName(doc.name).split("/");
      // Only `families/{familyId}/members/{memberId}` — a collection-group scan
      // matches on collection id alone and would otherwise pick up a `members`
      // subcollection hanging off any other parent.
      return segments.length === 4 && segments[0] === "families" && segments[2] === "members";
    })
    .map((doc) => ({
      familyId: familyIdFromName(doc.name),
      memberId: documentIdOf(doc.name),
      email: readStringField(doc.fields, "email"),
      uid: readStringField(doc.fields, "uid"),
      name: readStringField(doc.fields, "name"),
      status: readStringField(doc.fields, "status"),
      role: readStringField(doc.fields, "role"),
      deleted: readBooleanField(doc.fields, "deleted"),
      createdAt: readStringField(doc.fields, "createdAt"),
    }));
}

function toAssigneeRefs(collectionId: string, result: ScanResult): AssigneeRefRecord[] {
  const refs: AssigneeRefRecord[] = [];
  for (const doc of result.documents) {
    const familyId = familyIdFromName(doc.name);
    if (!familyId) continue;
    for (const hit of walkStringValues(doc.fields)) {
      if (!ASSIGNEE_FIELD.test(hit.fieldPath) || !looksLikeEmail(hit.value)) continue;
      refs.push({
        familyId,
        collectionId,
        docId: documentIdOf(doc.name),
        fieldPath: hit.fieldPath,
        value: hit.value,
        status: readStringField(doc.fields, "status"),
        deleted: readBooleanField(doc.fields, "deleted"),
      });
    }
  }
  return refs;
}

type FindingAccumulator = {
  documents: Set<string>;
  values: number;
  distinct: Set<string>;
  relay: number;
  samples: Set<string>;
};

function sweepEmails(
  collectionId: string,
  result: ScanResult,
  includeRaw: boolean,
  into: Map<string, EmailFieldFinding>,
) {
  const accumulators = new Map<string, FindingAccumulator>();
  const touch = (key: string) => {
    const existing = accumulators.get(key);
    if (existing) return existing;
    const created: FindingAccumulator = {
      documents: new Set(),
      values: 0,
      distinct: new Set(),
      relay: 0,
      samples: new Set(),
    };
    accumulators.set(key, created);
    return created;
  };
  const record = (key: string, docName: string, value: string) => {
    const accumulator = touch(key);
    accumulator.documents.add(docName);
    accumulator.values += 1;
    accumulator.distinct.add(normalizeEmail(value));
    if (isPrivateRelayEmail(value)) accumulator.relay += 1;
    if (accumulator.samples.size < 5) {
      accumulator.samples.add(includeRaw ? normalizeEmail(value) : redactEmail(value));
    }
  };

  for (const doc of result.documents) {
    const docId = documentIdOf(doc.name);
    if (looksLikeEmail(docId)) record("\u0000documentId", doc.name, docId);
    for (const hit of walkStringValues(doc.fields)) {
      if (looksLikeEmail(hit.value)) record(hit.fieldPath, doc.name, hit.value);
    }
  }

  for (const [key, accumulator] of accumulators) {
    const isDocumentId = key === "\u0000documentId";
    into.set(`${collectionId}::${key}`, {
      collectionId,
      location: isDocumentId ? "documentId" : "field",
      fieldPath: isDocumentId ? "" : key,
      documentCount: accumulator.documents.size,
      valueCount: accumulator.values,
      distinctEmails: accumulator.distinct.size,
      privateRelayCount: accumulator.relay,
      sampleValues: [...accumulator.samples],
    });
  }
}

async function buildSnapshot(reader: DryRunReader, options: Options): Promise<EmailKeyingSnapshot> {
  const coverage: ScanCoverage[] = [];
  const note = (collectionId: string, scope: ScanCoverage["scope"], result: ScanResult) => {
    coverage.push({
      collectionId,
      scope,
      documentsScanned: result.documents.length,
      cap: result.cap,
      complete: result.complete,
    });
    return result;
  };

  log("reading families...");
  const familiesResult = note(
    "families",
    "collection",
    requireComplete("families", await reader.listCollection("families", options.cap)),
  );
  const families: FamilyRecord[] = familiesResult.documents.map((doc) => ({
    familyId: documentIdOf(doc.name),
    name: readStringField(doc.fields, "name"),
    deleted: readBooleanField(doc.fields, "deleted"),
    createdAt: readStringField(doc.fields, "createdAt"),
  }));
  log(`families: ${families.length}`);

  log("reading users...");
  const usersResult = note(
    "users",
    "collection",
    requireComplete("users", await reader.listCollection("users", options.cap)),
  );
  const users: UserRecord[] = usersResult.documents.map((doc) => ({
    uid: documentIdOf(doc.name),
    email: readStringField(doc.fields, "email"),
    familyIds: readStringArrayField(doc.fields, "familyIds"),
    provider: readStringField(doc.fields, "provider"),
  }));
  log(`users: ${users.length}`);

  const collectionIds = await discoverCollectionIds(
    reader,
    options,
    families.map((family) => `families/${family.familyId}`),
    users.map((user) => `users/${user.uid}`),
  );
  log(`collections to scan: ${collectionIds.join(", ")}`);

  const assigneeRefs: AssigneeRefRecord[] = [];
  const findings = new Map<string, EmailFieldFinding>();
  const scanned = new Map<string, ScanResult>([
    ["families", familiesResult],
    ["users", usersResult],
  ]);

  // With --no-sweep, still scan the collections the targeted sections need.
  const targets = options.sweep
    ? collectionIds
    : collectionIds.filter((id) => REQUIRED_COLLECTIONS.has(id));

  for (const collectionId of targets) {
    if (scanned.has(collectionId)) continue;
    log(`scanning collection group "${collectionId}"...`);
    const result = requireComplete(
      collectionId,
      await reader.scanCollectionGroup(collectionId, options.cap),
    );
    note(collectionId, "collectionGroup", result);
    scanned.set(collectionId, result);
    if (ASSIGNEE_COLLECTIONS.has(collectionId)) {
      assigneeRefs.push(...toAssigneeRefs(collectionId, result));
    }
    if (options.sweep) {
      sweepEmails(collectionId, result, options.includeEmails, findings);
    }
  }

  const members = toMemberRecords(scanned.get("members") ?? emptyScan(options.cap));
  log(`member docs: ${members.length}`);

  // `inviteLookup` and `familyInvites` are top-level collections; the group scan
  // above is a superset, so filter to root documents rather than reading twice.
  const inviteLookups: InviteLookupRecord[] = topLevelDocs(scanned.get("inviteLookup")).map(
    (doc) => ({
      docId: documentIdOf(doc.name),
      email: readStringField(doc.fields, "email"),
      familyId: readStringField(doc.fields, "familyId"),
      status: readStringField(doc.fields, "status"),
    }),
  );
  log(`inviteLookup docs: ${inviteLookups.length}`);
  const familyInviteCount = topLevelDocs(scanned.get("familyInvites")).length;
  log(`email-valued assignee refs: ${assigneeRefs.length}`);

  return {
    readAt: new Date().toISOString(),
    projectId: reader.projectId,
    families,
    members,
    users,
    inviteLookups,
    assigneeRefs,
    otherFindings: [...findings.values()].sort(
      (a, b) =>
        b.valueCount - a.valueCount ||
        a.collectionId.localeCompare(b.collectionId) ||
        a.fieldPath.localeCompare(b.fieldPath),
    ),
    coverage,
    familyInviteCount,
    includeRawEmails: options.includeEmails,
  };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const reader = createDryRunReader();
  log(`mode=${reader.mode} project=${reader.projectId} (READ ONLY — nothing is written)`);

  const snapshot = await buildSnapshot(reader, options);
  const audit = analyzeEmailKeying(snapshot);
  const markdown = renderEmailKeyingReport(audit);

  const outDir = path.dirname(path.resolve(options.out));
  await mkdir(outDir, { recursive: true });
  const jsonPath = `${path.resolve(options.out)}.json`;
  const markdownPath = `${path.resolve(options.out)}.md`;
  await writeFile(jsonPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, markdown, "utf8");

  console.log("");
  console.log(markdown);
  console.log(`Wrote ${markdownPath}`);
  console.log(`Wrote ${jsonPath}`);
  if (!audit.coverageComplete) {
    throw new Error("SCAN_INCOMPLETE: at least one collection was truncated.");
  }
}

main().catch((error: unknown) => {
  console.error(
    "[EMAIL_KEYING_DRY_RUN_ERROR]",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
