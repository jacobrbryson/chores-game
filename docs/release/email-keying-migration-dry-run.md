# Email-keying migration — dry-run tooling and analysis

Companion to `docs/release/sign-in-with-apple.md` ("Full email-keying audit" →
"What the follow-up migration pass still has to do", steps 1–6). Written
2026-08-13.

---

## Status: run against production 2026-08-14

Run against `chores-game-487516-f72eb` with the service-account credentials in
`apps/web/.env.local`. **Read-only; nothing was written.** All 44 collection
scans completed their cursors — the counts below are exact, not sampled.

Headline numbers:

| metric | count |
| --- | --- |
| families | 10 (4 carry email keying) |
| member docs | 90 — **84 uid-keyed, 6 email-keyed** |
| email-keyed member docs by disposition | **0 stale, 0 migratable, 6 pending invite, 0 inert** |
| `inviteLookup` docs | 11 — **5 true orphans, 6 backing live invites** |
| email-valued chore assignee refs | 43, all resolve — **12 on live Open/Submitted chores** |
| private-relay addresses persisted | **0** |
| stranded users (`familyIds` empty or wrong) | **0** |
| `familyInvites` (new token flow) | **0 — never used in production** |

Before this run, the tooling was also unit-tested (26 tests over the
classification rules) and exercised end to end against the Firestore emulator
with a seeded fixture covering every category. The truncation guard was verified
by forcing it to fire (`--cap 3`), as were the redaction default and
`--no-sweep`.

---

## Running it against real data

From the repo root, with admin credentials in the environment:

```bash
FIREBASE_PROJECT_ID=<your-project-id> GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json npm run migration:email-keying-dry-run
```

`FIREBASE_SERVICE_ACCOUNT_KEY` (inline JSON) works in place of
`GOOGLE_APPLICATION_CREDENTIALS`; these are the same two credential sources
`apps/web/src/lib/firestore/admin.ts` already reads.

Outputs land at `.dry-run/email-keying.md` (human) and
`.dry-run/email-keying.json` (machine). `.dry-run/` is gitignored.

Useful flags:

| flag | effect |
| --- | --- |
| `--out <prefix>` | Output path prefix. Default `.dry-run/email-keying`. |
| `--include-emails` | Write raw addresses instead of `a***@domain`. The output then holds `CHILD_SENSITIVE` data. |
| `--cap <n>` | Per-collection safety cap (default 200 000). The run **fails** rather than emitting an under-counted report. |
| `--no-sweep` | Skip the generic all-collections email sweep (faster; loses section 5). |
| `--skip <a,b>` | Skip named collections. |

To re-prove the tooling works without touching real data:

```bash
npm run test:email-keying-dry-run -w @apps/web
```

That boots the Firestore emulator, seeds the fixture, and runs the real script
against it.

### It writes nothing

`scripts/email-keying-dry-run.ts` and `scripts/lib/email-keying-reader.ts`
contain no write path. The only `POST`s in either file are Firestore's two
read-only RPCs, `:runQuery` and `:listCollectionIds`. The only files created are
the two report files.

---

## What it reads, and how it avoids under-counting

Every read is cursor-paginated to exhaustion and **asserts** it reached the end.
If any scan hits its cap the script throws `SCAN_TRUNCATED` and refuses to emit
a report at all. Section 0 of the report lists every collection scanned, the
document count, and whether the cursor completed.

This is deliberately unlike two existing patterns in the codebase:

- `apps/web/src/lib/newsletters/service.ts` reads `families` with a hard cap of
  500 and silently drops the overflow.
- `apps/web/src/app/api/support/stale-invites/route.ts` reads members with a
  single unpaginated `adminRunQuery({ limit: 2000 })` page.

Collections are **discovered**, not hard-coded: root collection ids via
`listCollectionIds`, then every `families/*` and `users/*` document probed for
subcollection ids, then a sampled probe for third-level nesting (which is how
`supportRequests/{id}/internalNotes` gets found). Each discovered collection is
then swept for email-shaped document ids and email-shaped string values at any
depth, including inside arrays and maps. That is what answers "any OTHER
collection that stores an email as an identity key" without assuming the list in
the brief is complete.

### Classification rules (report section 2)

For each `families/{familyId}/members/{email}` document, in the same family:

| disposition | rule | migration action |
| --- | --- | --- |
| `stale_orphan` | a **non-deleted uid-keyed** member doc covers the same person (matched by declared `uid`, then by `email` field, then via `users/{uid}.email`) | **safe to delete** |
| `migratable` | no uid-keyed counterpart, but the person's uid IS known | **must be rewritten** to `members/{uid}` — deleting loses the record |
| `pending_invite` | no uid-keyed counterpart and no uid anywhere | keep, or expire deliberately |
| `revoked_or_deleted` | `deleted == true` or `status == "revoked"` | inert |

A soft-deleted counterpart does **not** count as covering the person, and
counterparts are never matched across family boundaries. Both rules are pinned
by tests.

---

## Reconciliation with the support console's Stale Invites panel

The report recomputes the panel's own rule over the complete data set and diffs
it against this audit's `stale_orphan` set (report section 9). **The two
definitions do not agree**, and the migration needs to pick one. The
disagreements, all confirmed against `api/support/stale-invites/route.ts`:

1. **The panel matches on the `email` *field*; this audit matches on the
   *document id*.** So the panel also flags uid-keyed invited duplicates —
   real cleanup targets, but not things the migration re-keys.
2. **An email-keyed doc with a blank `email` field is invisible to the panel**
   (it requires `member.email` to be truthy) but is plainly in scope here.
3. **The panel requires the counterpart to be exactly `status == "active"`**,
   so a `claimed` counterpart is missed.
4. **The panel ignores the `deleted` flag**, so it can list already-revoked
   records as actionable.
5. **The panel's read is capped at 2000 member docs in one unpaginated page.**
   Past that it silently under-counts.

**Recommendation:** adopt the document-id definition for the migration (it is
the only one that maps 1:1 onto "documents whose key must change"), and treat
the panel as a separate, broader hygiene tool. Points 4 and 5 are bugs in the
panel regardless of the migration.

**Production result: both definitions return 0.** There are no stale invites.
Every one of the 6 email-keyed member docs is a live, unredeemed invitation to
someone who has never signed in — none of them has a uid-keyed counterpart, so
none is a duplicate. The two definitions cannot currently be distinguished by
data, only in principle; the divergence is latent, not active.

The junk that *does* exist is one level over, in `inviteLookup` — see below.

---

## Analysis

### Q1 — How many pending invites exist, and should they be migrated or expired?

**Read:** `emailKeyedMembers.pendingInviteCount` (all unredeemed email-keyed
invites), and `emailKeyedMembers.byDisposition.pending_invite` (the subset where
no uid exists anywhere).

**Recommendation: expire them and have parents re-invite through the token
flow — and this holds regardless of the count.** The argument is structural,
not volumetric:

- For a `pending_invite` row there is **no uid to migrate to**. "Migrating" it
  can only mean moving the document to a generated id and minting a
  `familyInvites` code — which is byte-for-byte what re-inviting already does
  via `lib/family/invite-repository.ts`. Migrating buys nothing over expiring
  except that the parent does not have to click a button.
- A migrated-but-not-reissued invite is **still unredeemable by the case that
  motivated all of this**: an invitee arriving with an Apple private relay
  address matches no email, so the invite stays stuck.
- Expiring is a delete of records nobody has acted on. Migrating is a
  write-and-rewrite of live authorization data. The blast radius is not
  comparable.

Where the number *does* change the plan is **how** the invites get reissued:

- **Below ~200:** expire, and let parents re-invite by hand. No tooling needed.
- **~200–2000:** expire, but back-fill a `familyInvites` code for each and send
  the new `/join?code=…` link automatically, so no parent has to act.
- **Above ~2000:** do the back-fill in batches with an audit record per invite,
  and stage the `inviteLookup` teardown behind it.

**Production answer: 6 pending invites, across 4 families.** That is far below
the ~200 threshold, so the cheapest option is also the right one: expire the 6
and have those 4 parents re-invite through `/join?code=…`. No back-fill tooling
is warranted.

One caveat that the count alone does not show: **`totals.familyInvites` is 0** —
the token flow shipped but has never been exercised in production. Smoke-test
one real invite end to end (create → email → redeem) *before* expiring the 6,
or the migration trades six working legacy invites for six that depend on an
untested path.

The 6 invites, by family:

| family | pending |
| --- | --- |
| The Wallace Family | 2 |
| The Abbasi Family | 2 |
| The Marie Family | 1 |
| `c0d04319-…` (**family document missing**) | 1 |

That last row is its own problem: 4 member docs and an `inviteLookup` record
exist for a family whose `families/{familyId}` document does not. Re-inviting
into it cannot work. It needs a decision — restore the family document, or
retire the whole family — before its invite is touched.

### Q2 — Which categories are safe to delete versus must be rewritten?

**Production result up front:** the only category with anything in it that is
safe to delete is `inviteLookup` orphans — **5 records**. Confirmed by a
per-row read: all 5 are people who accepted their invite (their email-keyed
member doc is gone, they have an active uid-keyed member doc) and the index
record was left behind. `stale_orphan` and `revoked_or_deleted` are both 0, and
there are 0 dangling assignee refs. The remaining 6 `inviteLookup` records back
the 6 live invites and **must be kept** — `lib/auth/idp-signin.ts` reads them to
resolve the family at sign-in, so deleting them breaks those invites.

**Safe to delete outright:**

- `emailKeyedMembers.byDisposition.stale_orphan` — a live uid-keyed doc already
  holds this person's membership, role, and coins. The email doc is a duplicate.
  Soft-delete rather than hard-delete for one release so it is reversible.
- `emailKeyedMembers.byDisposition.revoked_or_deleted` — already inert.
- `inviteLookup.familyMissing` — points at a family document that does not
  exist. Unreachable by definition.
- `inviteLookup.orphanedByAcceptedMember` — the person already has an active
  uid-keyed member doc, so the index can only mislead the sign-in cascade.
- `assigneeRefs.dangles` where the containing document is also soft-deleted
  (`assigneeRefs.onDeletedDocs`) — dead references on dead chores.

**Must be rewritten, never dropped:**

- `emailKeyedMembers.byDisposition.migratable` — the person exists and has a
  uid, but no uid-keyed member doc. Deleting this deletes their membership.
  Rewrite to `members/{uid}`, then soft-delete the email-keyed original.
- `assigneeRefs.resolves` — every email-valued `assigneeId` / `assigneeIds[]`
  that still points at a live member. `assigneeRefs.onOpenChores` is the number
  that matters: those are chores a child can complete *today*, and getting the
  rewrite wrong silently removes that ability. This is exactly what the rules
  suite in `apps/web/tests/rules/` exists to protect.
- `strandedUsers.familyIdsEmpty` and `strandedUsers.familyIdsMissingThatFamily`
   — these people need `users/{uid}.familyIds` repaired, not their records
  removed.

**Needs a decision, not a default:**

- `assigneeRefs.dangles` on **live** chores. The address matches no member at
  all. Rewriting is impossible; deleting the reference orphans the chore. My
  recommendation is to reassign to the family admin and audit-log each one,
  rather than leave a chore nobody can complete.
- `edgeCases.emailFieldDisagreesWithKey` — the document id and the stored
  `email` disagree. Which one is the person's real address is not derivable from
  the data; these need eyes on them before any automated rewrite.
- `edgeCases.emailInMultipleFamilies` — one address keyed in more than one
  family. Rewriting each to the same uid is correct only if it really is the
  same person; if the count is non-zero, verify before batching.
- `privateRelay.byLocation` — any `members#documentId` or
  `inviteLookup#documentId` hit is a relay address that was written as a key
  before `lib/auth/private-relay.ts` landed. Those keys are junk by construction
  and can be dropped, but the account behind them is real and needs uid-keyed
  membership written first.

### Q3 — Blast radius if the rules change lands before the data is migrated

`apps/web/firestore.rules` references `request.auth.token.email` in **17
places** (verified by grep, matching the audit doc). Dropping it early breaks,
concretely:

1. **`hasEmailMemberDoc()` (line 74) → membership itself.** Any user whose only
   membership record is `members/{email}` stops being a family member for rules
   purposes. They lose read access to the family document, the member list,
   chores, rewards, and the feed. The app does not show an error — it shows an
   empty family. **Affected population: `emailKeyedMembers.byDisposition`
   `migratable + pending_invite`**, i.e. every email-keyed doc *without* a
   uid-keyed counterpart. Stale orphans are unaffected, because their uid doc
   still grants membership.
2. **`isRequesterAssigneeId()` (line 128) and `requesterMatchesChoreAssignee`
   (line 654) → chore completion.** A child whose chores carry an email-valued
   `assigneeId`/`assigneeIds` can no longer mark them complete. **Affected
   population: `assigneeRefs.onOpenChores`.** This is the loudest failure and
   the one families will report. Note it hits even children who *do* have a
   uid-keyed member doc, because the chore document is what holds the stale
   reference — so it is a strictly larger population than (1).
3. **`memberDocPathByEmail()` / the member-claim constraints (lines 352, 875,
   893) → invite acceptance.** An invitee can no longer create their own
   uid-keyed member doc from an email invite. Every unredeemed legacy invite
   becomes unacceptable through the old path. **Affected population:
   `emailKeyedMembers.pendingInviteCount`.** The new `/join?code=…` redemption
   path is unaffected: it uses admin credentials and compares no addresses.
4. **`match /inviteLookup/{email}` read rule (line 1414) → sign-in recovery.**
   `lib/auth/idp-signin.ts` and `api/family/summary` both read
   `inviteLookup/{email}` with the *user's* token. Denying that read removes the
   family-recovery fallback for anyone not yet in `users/{uid}.familyIds` —
   which is precisely the `strandedUsers` population, plus everyone in (3).
5. **The `isFamilyAdmin` email branch → parent lockout.** A parent whose own
   membership is email-keyed loses admin, and therefore loses the ability to
   re-invite the child whose invite just broke. This is the failure mode with no
   self-service recovery, and it is the reason the ordering in
   `sign-in-with-apple.md` puts the rules change last.

**Worst case is not additive** — one family can be hit by several at once — but
the useful upper bound is:

```
families at risk = report section 10, count of rows where
                   (migratable + pendingInvites) > 0
                   OR emailAssigneeRefs > 0
                   OR strandedUsers > 0
```

The report prints that table directly. If it is zero rows, the rules change is
safe to land. If it is non-zero, it is not — regardless of how small the
absolute document counts are, because the failure is total for an affected
family, not partial.

**Production result: 5 of 10 families are at risk, so the rules change is not
safe to land today.** Concretely:

- **12 live `Open`/`Submitted` chores** carry an email-valued
  `assigneeId`/`assigneeIds`, across 3 families (Ross Bryson 15 refs, Abbasi 26,
  Marie 2 — 43 total, of which 12 are on chores that are still completable).
  These children lose the ability to complete their own chores. This is the
  largest and loudest impact. The other 31 refs sit on `Deleted`/`Approved`
  chores and are inert.
- **6 pending invites** across 4 families become unacceptable through the legacy
  path (impact 3 above). The `/join?code=…` path is unaffected — but it has
  never been used in production, so it is not yet a proven fallback.
- **6 `inviteLookup` reads** stop resolving (impact 4), removing the sign-in
  family-recovery fallback for exactly those 6 invitees.

The good news, and it is genuinely good: **`strandedUsers` is 0 across the
board** — no `familyIds` is empty or points at the wrong family. Nobody is
currently locked out of their own family, so there is no pre-existing breakage
to repair first. **`privateRelay` is also 0** everywhere, so no relay address has
ever been written as a document key; `lib/auth/private-relay.ts` landed before
any Apple user got far enough to create one.

Order of operations that follows from these numbers: rewrite the 12 live chore
assignee refs → smoke-test the token flow → expire and reissue the 6 invites →
delete the 5 `inviteLookup` orphans → then drop `request.auth.token.email`.

---

## Applied 2026-08-15: 5 orphaned `inviteLookup` records deleted

The only cleanup executed against production so far. `inviteLookup` went from 11
documents to 6; the 6 remaining back the 6 live pending invites and one points
at the orphaned family below.

- Tool: `scripts/cleanup-orphaned-invite-lookups.ts`
  (`npm run migration:cleanup-invite-lookups`). Dry run by default; `--apply`
  required. Run with `--expect 5` so drift between audit and cleanup would abort.
- The orphan set is re-derived from live data every run — never a stored list.
  A record is deleted only when its family exists and is not deleted, no
  `members/{email}` doc remains, and an `active` non-deleted uid-keyed member doc
  in that family carries the same address. The membership survives; only the
  redundant index is removed.
- An immutable audit record (`invite_lookup_orphan_deleted`) is written **before**
  each delete, so an audit failure aborts before data loss. All 5 verified
  present under `families/{familyId}/auditLogs`.
- Full contents of every deleted document were captured to
  `.dry-run/invite-lookup-cleanup-applied.json` for restore.
- Verified after: re-running the cleanup finds 0 orphans, and a fresh dry run
  reports `inviteLookup.orphanedByAcceptedMember = 0` and
  `memberMissing = 0` with all other counts unchanged.

Predicate is covered by 10 unit tests in
`apps/web/src/lib/migration/invite-lookup-orphans.test.ts`.

## Applied 2026-08-15: 10 chore assignee refs rewritten to uids

Phase 2 step 2, for live chores only. Tool:
`scripts/rewrite-email-chore-assignees.ts`
(`npm run migration:rewrite-chore-assignees`), same safety model — dry run
default, `--expect` drift guard, audit-before-write, restore receipt.

Two corrections to the numbers above: the "12 live refs" are **12 references
across 11 chores** (one chore carries the address in both `assigneeId` and
`assigneeIds[]`), and only **10 of the 12 were rewritable**.

- **10 rewritten**, each to the single active uid-keyed member carrying that
  address: 5 chores in `6c3b16ed` → `ckftwrdhhde…`, 5 in `c9ece444` →
  `uQaL2tnIcxYz…`. All were `Submitted`. Only `assigneeId` needed changing.
- **2 refs on 1 chore could NOT be rewritten** — chore `bb13c63d` in family
  `b2014c30` is assigned to `w***@gmail.com`, who is one of the 5 remaining
  pending invitees. **There is no uid to rewrite to.** This is the case the
  audit doc predicted: a chore assigned by email before the invitee accepted.
  It cannot be fixed by migration — it needs that invite redeemed, or the chore
  reassigned. **It is now the last thing blocking the rules change.**
- **31 refs on non-live chores** (`Approved`/`Deleted`) were left alone. They
  carry no authorization risk because those chores are not completable. Run
  `--scope all` to include them when convenient.

`updatedAt` was deliberately not bumped: this is a storage-format migration, not
a family edit, and bumping it would reorder chore lists for real users.

Live email-valued refs went 12 → 2; the total went 43 → 33.

## Applied 2026-08-15: orphaned family `c0d04319` data removed

`families/c0d04319-470a-4493-8e58-a8ad18893b9e` had no family document but
retained 21 documents across 7 subcollections. Investigation showed it was an
**abandoned onboarding family**: the admin (`r***@orcwood.com`) has since moved
to family `f49594ae…`, all 5 chores were the untouched starter-content set, and
nothing had been modified since 2026-06-07.

Tool: `scripts/delete-orphaned-family.ts`
(`npm run migration:delete-orphaned-family -- --family <id>`). It **refuses to
run if the family document exists** — verified by pointing it at a live family,
which it rejected — so it can only ever act on genuine leftovers. `--family` is
required; there is no default target.

- **17 documents deleted**: 4 members, 5 chores, 4 categories, 2
  achievementEvents, 1 reward, and 1 `inviteLookup` record.
- **5 documents retained**: 3 `consentEvents` and 2 `auditLogs`. AGENTS.md
  classifies consent history and audit records as immutable `ADMIN_ONLY`
  records; tidying up an abandoned family must not destroy the record of what
  happened. Retention is enforced by a constant in the script, not a flag.
- **`users/ebfffa7a…` had this family as its only `familyIds` entry** and was
  updated to `[]` rather than left dangling — deleting the family without this
  would have manufactured a stranded user.
- Two audit records written (`orphaned_family_data_purged`,
  `user_family_reference_cleared`) into the retained `auditLogs`.
- Full contents of all 17 deleted documents are in
  `.dry-run/orphaned-family-c0d04319-applied.json`.

## Applied 2026-08-15: 5 pending invites expired, 1 blocked chore removed

Tool: `scripts/expire-pending-email-invites.ts`
(`npm run migration:expire-pending-invites`).

Done in the product's own idiom rather than by hard deleting, because these were
live invitations in three families that are not ours:

| what | write | mirrors |
| --- | --- | --- |
| `members/{email}` | `deleted: true`, `deletedAt` | `DELETE /api/family/members/{memberId}` |
| `inviteLookup/{email}` | `status: "revoked"`, `updatedAt` | same route (record kept) |
| chore (only assignee) | `deleted`, `deletedAt`, `status: "Deleted"`, `updatedAt` | `DELETE /api/chores/{choreId}` |

This ends the exposure without an irreversible delete: `hasEmailMemberDoc()`
requires `deleted != true`, so a soft-deleted email-keyed doc grants nothing,
and the sign-in cascade ignores a `revoked` inviteLookup. Flipping `deleted`
back restores any of it.

- **5 invitations expired** — 2 in The Wallace Family, 2 in The Abbasi Family,
  1 in The Marie Family. **4 of the 5 were `admin` (co-parent) invites**, not
  child invites.
- **1 chore soft-deleted** — `bb13c63d` in The Marie Family, whose only assignee
  was the expired invitee. A chore with other assignees would have kept the
  chore and dropped just that reference; the planner covers both paths.
- 5 `invite_expired` + 1 `chore_status_changed` audit records written.
- Restore data in `.dry-run/pending-invite-expiry-applied.json`.

**Live email-valued assignee references are now 0.** The data side of the
migration is done; what remains is code.

## Current production state (2026-08-15, after all four passes)

| metric | before | now |
| --- | --- | --- |
| families carrying email keying | 4 | 3 |
| member docs | 90 | 86 |
| email-keyed member docs | 6 | 5 — **all soft-deleted / inert** |
| unredeemed email invitations | 6 | **0** |
| `inviteLookup` docs | 11 | 5 — all `revoked` |
| email-valued assignee refs | 43 | 33 (all on `Approved`/`Deleted` chores) |
| …of those, on live chores | 12 | **0** |
| families with a missing family document | 1 | 0 |
| stranded users / private-relay addresses | 0 / 0 | 0 / 0 |

Audit trail: 5 `invite_lookup_orphan_deleted`, 10
`chore_assignee_email_rewritten`, 1 `orphaned_family_data_purged`, 1
`user_family_reference_cleared`, 5 `invite_expired`, 1 `chore_status_changed`.

**The data no longer blocks `request.auth.token.email` being dropped.** Nothing
live depends on email-keyed identity. What remains is code, per
`sign-in-with-apple.md` steps 4-6:

1. Drop `request.auth.token.email` from `firestore.rules` (17 occurrences) and
   flip the two private-relay tests in `apps/web/tests/rules/` from denied to
   allowed. Run `npm run test:rules -w @apps/web` as the safety net.
2. Retire `inviteLookup` reads in `lib/auth/idp-signin.ts`,
   `api/family/summary`, and `api/family/invitations/accept`.
3. Remove the email alias from `buildFamilyMemberAliasMap` last.
4. Fix `api/family/privacy/export` member matching.

**Still outstanding operationally:** `familyInvites` remains **0** — the invite
code flow has never completed in production, and 5 families' invitations were
just expired against it. Smoke-test create → email → redeem before telling those
parents to re-invite. The 33 remaining refs on `Approved`/`Deleted` chores are
inert but will matter for step 3; clear them with
`npm run migration:rewrite-chore-assignees -- --scope all`.

## Code migration 2026-08-15 (steps 4-6) — written, NOT deployed

All four code steps are done and green locally. **`firestore.rules` has not been
deployed** — nothing here is live until `firebase deploy --only firestore:rules`.

### 1. `request.auth.token.email` removed from the rules

17 occurrences → **1**, deliberate. Removed `memberDocPathByEmail`,
`hasEmailMemberDoc`, `hasClaimableEmailInvite`, `inviteRoleAllowsClaim`, and
`requesterMemberIdsForFamily`. `isFamilyMember`, `isFamilyAdmin`,
`isRequesterAssigneeId`, `isRequesterInAssigneeIds`, and
`requesterMatchesChoreAssignee` are uid-only. The `inviteLookup` read rule is
`if false`; admin writes stay so the existing revoke path still works.

**The one kept occurrence** is in `isValidSelfUserAuthSync`: it stops a user
writing an arbitrary address into their *own* `users/{uid}` document. That is
self-document integrity, not cross-identity authorization, and it is correct for
Hide My Email — the relay address is both what the token carries and what
`contactEmail()` persists, so the two still match. Removing it would loosen the
rule, not tighten it. It carries a comment saying so.

### On "flip the two private-relay tests from denied to allowed"

Done differently, because a blanket flip would have asserted something false. A
private-relay user with no membership is still denied — correctly, exactly as
any non-member is. What changed is *why*. So each relay test was reframed as
"denied like any non-member", and a new test added alongside it proving the
thing that actually matters: **once redemption has written their uid-keyed
member doc, the relay address is irrelevant and they get full access / can
complete their chore.**

Rules suite: **34 tests, all passing** (was 31).

### 2. `inviteLookup` reads retired

`lib/auth/idp-signin.ts`, `api/family/summary`, and
`api/family/invitations/accept` now resolve family membership with
`findFirstFamilyIdByMemberUid`. The `findFirstFamilyIdByMemberEmail` fallback
went with them — it could never match a relay address, and matching on an
address is what let a second Google account land in someone else's family.
Writes from `api/family/members`, `reinvite`, and revoke are untouched.

### 3. Email alias removed from `buildFamilyMemberAliasMap`

Identity is `id`/`uid` only. A stale email-valued `assigneeId` now resolves to
nobody and renders as unassigned, rather than silently naming a person.

### 4. `api/family/privacy/export` member matching fixed

Stale-invite detection matched on the `email` field, which exported the wrong
records for a relay user and could merge two people sharing an address. It now
matches on uid / document id.

**Verification:** 763 unit tests across 117 files passing, 34 rules tests
passing, `tsc --noEmit` clean. `npm run lint` not run — ESLint is broken in this
repo per CLAUDE.md.

**Not done, deliberately:** deployment, and a changelog entry. The legacy
email-invite acceptance path is gone, so invitees now join by code — that is a
user-facing behavior change and per AGENTS.md warrants a changelog entry in all
three locales.

## Spotted, not fixed

Per the brief, these were observed during the sweep and deliberately left alone:

- **`api/support/stale-invites/route.ts` reads at most 2000 member docs** in a
  single unpaginated `adminRunQuery`. Past that it under-counts with no signal.
  Same class of bug as the 500-family cap in `lib/newsletters/service.ts`.
- **Two root `package.json` scripts point at files that do not exist**:
  `wallet:rebuild` → `scripts/rebuild-wallet-balances.mjs` and
  `admin:grant-confetti` → `scripts/admin/grant-all-confetti-options.mjs`.
- **`api/family/privacy/export/route.ts` still matches members by email**,
  already noted as step 6 of the migration in `sign-in-with-apple.md`.
- **Family `c0d04319-470a-4493-8e58-a8ad18893b9e` has no family document** but
  still has 4 member docs and 1 `inviteLookup` record pointing at it. Orphaned
  data, not touched.
- **27 live member docs carry no email at all.** All 27 are uid-keyed, which is
  consistent with managed kiosk players — expected, not a defect, but worth
  confirming before any migration step assumes every member has an address.

## Files added

| file | role |
| --- | --- |
| `scripts/email-keying-dry-run.ts` | Entry point: args, orchestration, output. |
| `scripts/lib/email-keying-reader.ts` | Read-only Firestore layer (admin + emulator backends), cursor pagination, field walking. |
| `scripts/lib/ts-alias-register.mjs`, `ts-alias-hooks.mjs` | Node resolve hook for the `@/` alias, so the script uses the real `admin*` helpers instead of re-implementing service-account auth. |
| `scripts/test-data/seed-email-keying-fixture.mjs` | Emulator-only fixture covering every category. Refuses to run without `FIRESTORE_EMULATOR_HOST`. |
| `apps/web/src/lib/migration/email-keying-types.ts` | Input/output shapes. |
| `apps/web/src/lib/migration/email-keying-audit.ts` | Pure classification. No I/O. |
| `apps/web/src/lib/migration/email-keying-report.ts` | Markdown rendering. |
| `apps/web/src/lib/migration/email-keying-audit.test.ts` | 26 tests pinning the delete-vs-rewrite rules. |

One production file changed: `lib/firestore/admin.ts` gains a read-only
`adminListCollectionIds` (paginated), used for collection discovery. No existing
behaviour is affected.
