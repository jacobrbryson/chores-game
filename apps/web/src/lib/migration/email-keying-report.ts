import type {
  EmailKeyedMemberDisposition,
  EmailKeyingAudit,
} from "@/lib/migration/email-keying-types";

/**
 * Markdown rendering for the email-keying dry run. Pure: takes the audit
 * produced by `analyzeEmailKeying` and returns a string. The runner writes it
 * next to the JSON summary.
 */

const DISPOSITION_LABELS: Record<EmailKeyedMemberDisposition, string> = {
  stale_orphan: "Stale orphan — a uid-keyed doc already covers this person. SAFE TO DELETE.",
  migratable: "Migratable — no uid-keyed doc, but the uid is known. MUST BE REWRITTEN.",
  pending_invite: "Pending invite — no uid anywhere. MUST BE KEPT or expired deliberately.",
  revoked_or_deleted: "Revoked / soft-deleted. Inert.",
};

function table(headers: string[], rows: Array<Array<string | number>>) {
  if (rows.length === 0) {
    return "_none_\n";
  }
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
  return `${head}\n${sep}\n${body}\n`;
}

function counterTable(counter: Record<string, number>, keyHeader: string) {
  const rows = Object.entries(counter)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, value]) => [key, value] as Array<string | number>);
  return table([keyHeader, "count"], rows);
}

function coverageSection(audit: EmailKeyingAudit) {
  const rows = audit.coverage.map((entry) => [
    entry.collectionId,
    entry.scope,
    entry.documentsScanned,
    entry.cap,
    entry.complete ? "complete" : "**TRUNCATED**",
  ]);
  const banner = audit.coverageComplete
    ? "Every scan below reached the end of its collection with an explicit cursor. The counts are exact, not sampled."
    : "**One or more scans hit their safety cap. Every number in this report is a LOWER BOUND. Re-run with a higher `--cap` before acting on it.**";
  return `${banner}\n\n${table(
    ["collection", "scope", "documents scanned", "cap", "status"],
    rows,
  )}`;
}

export function renderEmailKeyingReport(audit: EmailKeyingAudit) {
  const lines: string[] = [];
  const push = (text = "") => lines.push(text);

  push("# Email-keying migration — READ-ONLY dry run");
  push();
  push(`- Firestore project: \`${audit.projectId}\``);
  push(`- Read at: ${audit.readAt}`);
  push(
    `- Email addresses: ${audit.redacted ? "**redacted** (`a***@domain`) — re-run with `--include-emails` for raw values" : "**raw** (this file contains CHILD_SENSITIVE data — do not commit it)"}`,
  );
  push();
  push("> This run wrote nothing. It performs reads only.");
  push();

  push("## 0. Scan coverage");
  push();
  push(coverageSection(audit));

  push("## 1. Totals");
  push();
  push(
    table(
      ["metric", "count"],
      [
        ["families", audit.totals.families],
        ["families carrying email keying", audit.totals.familiesWithEmailKeyedMembers],
        ["member docs (all families)", audit.totals.memberDocs],
        ["email-keyed member docs", audit.totals.emailKeyedMemberDocs],
        ["uid-keyed member docs", audit.totals.uidKeyedMemberDocs],
        ["users", audit.totals.users],
        ["familyInvites (new token flow)", audit.totals.familyInvites],
      ],
    ),
  );

  push("## 2. Email-keyed member docs — `families/{familyId}/members/{email}`");
  push();
  push("### By stored status");
  push();
  push(counterTable(audit.emailKeyedMembers.byStatus, "status"));
  push("### By migration disposition");
  push();
  push(
    table(
      ["disposition", "count", "what it means"],
      (Object.keys(audit.emailKeyedMembers.byDisposition) as EmailKeyedMemberDisposition[]).map(
        (key) => [key, audit.emailKeyedMembers.byDisposition[key], DISPOSITION_LABELS[key]],
      ),
    ),
  );
  push(
    `Pending invites still awaiting redemption (non-deleted, \`invited\`/\`claimed\`, no uid-keyed counterpart): **${audit.emailKeyedMembers.pendingInviteCount}**`,
  );
  push();

  push("## 3. `inviteLookup/{email}`");
  push();
  push(
    table(
      ["metric", "count"],
      [
        ["total docs", audit.inviteLookup.total],
        ["referenced family document missing", audit.inviteLookup.familyMissing],
        ["referenced family soft-deleted", audit.inviteLookup.familyDeleted],
        ["referenced member doc missing", audit.inviteLookup.memberMissing],
        ["referenced member doc soft-deleted", audit.inviteLookup.memberDeleted],
        [
          "person already has an active uid-keyed member doc (orphan)",
          audit.inviteLookup.orphanedByAcceptedMember,
        ],
        ["private-relay address", audit.inviteLookup.privateRelay],
      ],
    ),
  );
  push("By status:");
  push();
  push(counterTable(audit.inviteLookup.byStatus, "status"));

  push("## 4. Email-valued assignee references");
  push();
  push(
    table(
      ["collection", "email-valued refs", "resolve to a live member", "dangle"],
      Object.entries(audit.assigneeRefs.byCollection).map(([collectionId, bucket]) => [
        collectionId,
        bucket.total,
        bucket.resolves,
        bucket.dangles,
      ]),
    ),
  );
  push(
    table(
      ["metric", "count"],
      [
        ["total email-valued assignee refs", audit.assigneeRefs.total],
        ["resolve to a non-deleted member", audit.assigneeRefs.resolves],
        ["dangle (no member matches)", audit.assigneeRefs.dangles],
        ["on soft-deleted documents", audit.assigneeRefs.onDeletedDocs],
        ["on live Open/Submitted chores", audit.assigneeRefs.onOpenChores],
        ["private-relay address", audit.assigneeRefs.privateRelay],
      ],
    ),
  );
  if (audit.assigneeRefs.samples.length > 0) {
    push(`Samples (first ${audit.assigneeRefs.samples.length}):`);
    push();
    push(
      table(
        ["family", "collection", "doc", "field", "value", "status", "deleted", "resolves"],
        audit.assigneeRefs.samples.map((sample) => [
          sample.familyId,
          sample.collectionId,
          sample.docId,
          sample.fieldPath,
          sample.value,
          sample.status || "(none)",
          sample.deleted ? "yes" : "no",
          sample.resolved ? "yes" : "**no**",
        ]),
      ),
    );
  }

  push("## 5. Every other place an email is stored as an identity key");
  push();
  push(
    "Discovered by sweeping every collection and collection group in the database for email-shaped document ids and email-shaped string values — not from a hand-written list.",
  );
  push();
  push(
    table(
      ["collection", "location", "field", "docs", "values", "distinct", "relay", "samples"],
      audit.otherEmailKeyedLocations.map((finding) => [
        finding.collectionId,
        finding.location,
        finding.fieldPath || "—",
        finding.documentCount,
        finding.valueCount,
        finding.distinctEmails,
        finding.privateRelayCount,
        finding.sampleValues.slice(0, 3).join(", "),
      ]),
    ),
  );

  push("## 6. Users stranded outside their family");
  push();
  push(
    "People with an email-keyed member doc whose `users/{uid}` record does not point back at that family. **These accounts are already broken today**, before any migration runs.",
  );
  push();
  push(
    table(
      ["condition", "count"],
      [
        ["`users/{uid}.familyIds` is empty", audit.strandedUsers.familyIdsEmpty],
        [
          "`familyIds` is non-empty but omits that family",
          audit.strandedUsers.familyIdsMissingThatFamily,
        ],
        [
          "no `users` doc at all (never signed in — expected for a live invite)",
          audit.strandedUsers.noUserDoc,
        ],
      ],
    ),
  );

  push("## 7. Apple private-relay addresses already persisted");
  push();
  push(`Total occurrences: **${audit.privateRelay.total}**`);
  push();
  push(counterTable(audit.privateRelay.byLocation, "location"));

  push("## 8. Edge cases");
  push();
  push(
    table(
      ["case", "count"],
      [
        [
          "same email keyed in more than one family",
          audit.edgeCases.emailInMultipleFamilies.count,
        ],
        [
          "email-keyed doc whose `email` field disagrees with its own id",
          audit.edgeCases.emailFieldDisagreesWithKey,
        ],
        [
          "email-keyed doc whose uid counterpart carries a different email",
          audit.edgeCases.counterpartEmailDisagrees,
        ],
        ["live member docs with no email at all", audit.edgeCases.membersWithNoEmail.total],
        [
          "addresses differing only by case or whitespace",
          audit.edgeCases.caseOrWhitespaceVariants.count,
        ],
      ],
    ),
  );
  if (audit.edgeCases.emailInMultipleFamilies.count > 0) {
    push("Emails present in multiple families:");
    push();
    push(
      table(
        ["email", "hash", "families"],
        audit.edgeCases.emailInMultipleFamilies.rows.map((row) => [
          row.emailKey,
          row.emailHash,
          row.familyIds.join(", "),
        ]),
      ),
    );
  }
  if (audit.edgeCases.caseOrWhitespaceVariants.count > 0) {
    push("Case/whitespace variants of the same address:");
    push();
    push(
      table(
        ["hash", "variants", "seen at"],
        audit.edgeCases.caseOrWhitespaceVariants.rows.map((row) => [
          row.emailHash,
          row.variants.map((variant) => `\`${variant}\``).join(" · "),
          row.locations.join(", "),
        ]),
      ),
    );
  }

  push("## 9. Reconciliation with the support console's Stale Invites panel");
  push();
  push(
    table(
      ["definition", "count"],
      [
        [
          "Stale Invites panel rule, recomputed over the complete data set",
          audit.staleInvitesReconciliation.panelDefinitionCount,
        ],
        [
          "this audit's `stale_orphan` disposition",
          audit.staleInvitesReconciliation.auditDefinitionCount,
        ],
        ["counted by the panel only", audit.staleInvitesReconciliation.panelOnly],
        ["counted by this audit only", audit.staleInvitesReconciliation.auditOnly],
        [
          "panel rows that are uid-keyed docs (not migration scope)",
          audit.staleInvitesReconciliation.panelUidKeyedRows,
        ],
      ],
    ),
  );
  if (audit.staleInvitesReconciliation.disagreements.length > 0) {
    push("Where the two definitions disagree — the migration needs to pick one:");
    push();
    for (const note of audit.staleInvitesReconciliation.disagreements) {
      push(`- ${note}`);
    }
    push();
  }

  push("## 10. Per-family breakdown");
  push();
  push(
    table(
      [
        "family",
        "name",
        "members",
        "email-keyed",
        "uid-keyed",
        "stale",
        "migratable",
        "pending",
        "inert",
        "inviteLookup",
        "email assignees",
        "dangling",
        "stranded",
        "relay",
      ],
      audit.families.map((row) => [
        row.familyId,
        row.familyDeleted ? `${row.familyName} (deleted)` : row.familyName,
        row.memberDocs,
        row.emailKeyedMemberDocs,
        row.uidKeyedMemberDocs,
        row.staleOrphans,
        row.migratable,
        row.pendingInvites,
        row.revokedOrDeleted,
        row.inviteLookupDocs,
        row.emailAssigneeRefs,
        row.emailAssigneeRefsDangling,
        row.strandedUsers,
        row.privateRelayHits,
      ]),
    ),
  );

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}
