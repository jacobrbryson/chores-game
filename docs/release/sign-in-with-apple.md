# Sign in with Apple — scope

Scoping doc for roadmap item 2 (iOS App Store). Written 2026-08-12, before implementation.

## Verdict

Adding Apple as a Firebase identity provider is **small**. The thing that makes this a real project is not the auth provider — it is that **Apple's "Hide My Email" breaks the email-keyed identity model this app uses to join people to families.**

Recommendation: implement Sign in with Apple, and fix the family-join path so it does not depend on email equality. The second half is the actual work, and it is worth doing regardless of Apple because it also removes a whole class of existing invite bugs.

## Is Apple actually required?

Guideline 4.8 applies to apps that use a third-party login service to set up or authenticate the user's primary account. This app is Google-only, so it is squarely in scope. The rule requires an alternative that limits data collection to name and email, **lets the user keep their email address private**, and does not track.

The tempting cheaper option — adding email/password sign-in instead — does **not** satisfy that middle requirement, since the user's real email is handed to us. In practice Sign in with Apple is the qualifying option.

Google sign-in stays exactly as it is. This adds a second door, it does not replace the first.

## The easy half: the provider itself

The current flow (`apps/web/src/app/api/auth/google/gsi/route.ts`) is:

1. Verify the Google ID token (`oauth2.googleapis.com/tokeninfo`, audience check).
2. Exchange it with Firebase Identity Toolkit: `accounts:signInWithIdp` with `postBody: id_token=…&providerId=google.com`.
3. Upsert `users/{uid}`, resolve family membership, write the signed `session_user` cookie.

Everything downstream of step 2 — the Firebase ID token, the refresh-token rotation in `runWithRefreshedFirebaseToken`, all Firestore REST access, the session cookie, roles — is **provider-agnostic**. It only ever sees a Firebase UID and an ID token.

So the Apple path is the same route with two differences:

- **Verification**: validate Apple's identity token against Apple's public keys (`appleid.apple.com/auth/keys`, RS256 JWT, verify `iss`, `aud`, `exp`, and the nonce) instead of Google's tokeninfo endpoint. Apple has no tokeninfo-style endpoint, so this is real JWT verification rather than an HTTP call.
- **Exchange**: `providerId=apple.com` with the same `signInWithIdp` call, plus the raw nonce.

That is the whole Firestore integration question: **there isn't a separate Firestore story.** Apple users become ordinary Firebase users with ordinary UIDs, and every existing Firestore rule, role check, and `users/{uid}` document works unchanged.

Two Apple-specific traps in this half:

- **Apple returns the user's name only on the very first authorization**, and never again. If it is not persisted on that first call, it is gone permanently and the member shows up nameless. Google returns it every time, so nothing in the current code is built to expect this.
- **Nonce handling is mandatory**: generate a nonce, send its SHA-256 to Apple, pass the raw value to `signInWithIdp`. Getting this wrong fails closed, which is at least loud.

## The hard half: Hide My Email vs. email-keyed identity

When a user picks "Hide My Email", Apple returns a per-app relay address like `x7k2p9@privaterelay.appleid.com`. It is stable for this app, and it is **not** the address the person's family knows them by.

This app joins people to families by email in several places:

- Invited members are stored as `members/{email}` (accepted members use `members/{uid}`).
- `inviteLookup/{email}` is an explicit index doc mapping an invited email to a family.
- Nine call sites across six route files key documents on a normalized email.

The sign-in path resolves family membership as a cascade (`upsertFirebaseUser`, `gsi/route.ts:164`):

1. `users/{uid}.familyIds[0]`
2. `inviteLookup/{normalizedEmail}`
3. `findFirstFamilyIdByMemberEmail(normalizedEmail)`
4. **otherwise → `createFamilyForUser(...)`, bootstrapping a brand-new family**

### The concrete failure

A parent invites their child at `kid@example.com`. The child opens the iOS app and signs in with Apple, choosing Hide My Email.

- No `users/{uid}` doc yet → step 1 misses.
- `inviteLookup/x7k2p9@privaterelay.appleid.com` does not exist → step 2 misses.
- No member doc with the relay email → step 3 misses.
- Step 4 fires: **the child is silently placed in a brand-new empty family of their own.**

No error, no prompt. From the parent's side the invite simply never gets accepted; from the child's side the app looks empty and broken. Recovering means a support-console cleanup of an orphan family plus a stale email-keyed invite.

This is not hypothetical or rare — it is the default outcome for any invited child who takes Apple's privacy option, and Apple's review process itself will exercise Hide My Email.

## Fixing it

The options, in order of how well they hold up:

**A. Join by invite token, not by email — recommended.**
Give invitations a short code or deep link carrying `{familyId, inviteId}` with an expiring signed token, and have the join path consume that instead of matching addresses. Email equality stops being load-bearing.

This is the robust fix rather than a patch, and it is not throwaway work: roadmap item 4 already calls for an invite build-out, and the Family Friends flow (`lib/family-friends/`) already establishes the expiring single-use token pattern to copy. The relay-email problem disappears because nothing compares addresses.

**B. Explicit "join a family" step as the safety net.**
When sign-in resolves no family, ask before bootstrapping — enter a code, or paste the invited email. Needed anyway for anyone who signs in before clicking their invite.

**C. Guard the bootstrap path.**
Silently creating a family should be the *last* resort, and it should never fire for a user who arrived via an invite link. This is a small, independently valuable hardening of existing behavior — the same silent-bootstrap trap can already be hit today by a user who signs in with a different Google address than the one they were invited at.

**Not viable:** requiring a non-hidden email (Apple forbids it), or leaning on Firebase's email-based account linking (it only works when the email is not hidden, which is exactly the case that breaks).

## Account linking across providers

The same person signing in with Google on web and Apple on iOS gets **two different Firebase UIDs**, and therefore two users and two families, unless the accounts are linked. Firebase can link by verified email — but Hide My Email defeats that too.

For V1 the honest answer is to keep it simple and make it visible: show which provider an account was created with, and let a signed-in user link a second provider deliberately from their profile. Trying to auto-merge identities silently is how people lose access to their own family data.

## Work breakdown

**Phase 1 — provider (small)**
- Apple Developer: enable Sign in with Apple, create the Services ID and key.
- Firebase Console: enable the Apple provider.
- `POST /api/auth/apple` (web) + `POST /api/auth/apple/mobile`, mirroring the two existing Google routes.
- Apple identity-token JWT verification against Apple's JWKS, with nonce validation.
- Persist the display name on first authorization only.
- Native: `expo-apple-authentication`, the Sign in with Apple capability, and the button per Apple's HIG (placement and styling are review items).
- Web: Sign in with Apple JS on the homepage next to the Google button.

**Phase 2 — identity model (the real work)**
- Invite tokens/codes (option A), the join-a-family step (option B), and the bootstrap guard (option C).
- Provider-agnostic account linking from the profile page.
- Support-console visibility: which provider, whether the email is a private relay.

**Phase 3 — parity and polish**
- Mobile + web parity, `/api/v1` proxy, three locales in both locale copies, audit logging on link/unlink, changelog.
- Verify the whole flow with Hide My Email explicitly turned on — this is the test that matters and it is easy to skip, since developers naturally use their real address.

## Adjacent App Store risk worth knowing now

Guideline 5.1.1(v) requires apps that support account creation to also offer **account deletion from inside the app**. The current privacy flow schedules deletion 30 days out and, per `CLAUDE.md`, the actual purge is not yet implemented. Whether a scheduled-deletion request satisfies review is uncertain, and it is a separate rejection risk from 4.8. Worth resolving in the same pass as item 2 rather than discovering it during review.

## Full email-keying audit (added 2026-08-13, after Phase 1 landed)

Phase 1 shipped: `/api/auth/apple` + `/api/auth/apple/mobile`, `lib/auth/apple-token.ts`, the shared `lib/auth/idp-signin.ts` extraction, and the bootstrap guard (`FamilyResolution = "resolved" | "needs_family_setup"` — authentication no longer silently manufactures a family).

The original scope named the application-route layer. A full sweep found **five more layers**, and one of them is more significant than everything already catalogued.

### 1. Firestore security rules — the layer that was missed

`apps/web/firestore.rules` keys **authorization itself** on `request.auth.token.email` — **17 occurrences** (an earlier estimate of "roughly eight" undercounted; the notable ones are below):

- `memberDocPathByEmail()` resolves membership to `members/{request.auth.token.email.lower()}` (line 64).
- Membership resolution returns the pair `[uidMemberId, emailMemberId]` (line 135–138).
- Player self-completion of a chore checks `assigneeId == request.auth.token.email.lower()` (line 128) and `choreData.assigneeIds.hasAny([request.auth.token.email.lower()])` (line 654).
- Member-doc creation constrains `request.resource.data.email.lower() == request.auth.token.email.lower()` (line 350–353).

This matters more than the route layer because it is **server-enforced authorization, not app convenience**. For an Apple private-relay user, `request.auth.token.email` *is* the relay address, so every grant that depends on matching the invited address silently fails — including a child's ability to complete a chore that was assigned to them by email before they accepted.

Changing these rules is the riskiest edit in the whole effort: too strict locks families out, too loose opens cross-family access. There is currently **no general Firestore rules test suite** (only `lib/voting/firestore-rules.test.ts`), so one should exist before this is touched.

### 2. Chore assignment identity

`assigneeIds` can contain an email address — that is precisely why the rules check it. Chores assigned to an invited-but-not-yet-accepted member are keyed by email, so any migration has to rewrite chore assignee references, not just member documents.

### 3. Alias matching as a compatibility shim

`lib/family/member-aliases.ts` (`buildFamilyMemberAliasMap`) deliberately maps id, uid, **and email** to the same member so the rest of the app can paper over the two keying schemes. It is the seam that currently hides the problem, and it should be the *last* thing removed, not the first.

### 4. Google Tasks sync

The 2026-08-09 changelog entry ("Google Tasks completions reach the app again … including family members who joined from an email invitation") is this exact seam having already caused a production bug once.

### 5. Privacy export / deletion

`api/family/privacy/export/route.ts` matches members by email when assembling an export. A member whose identity is a relay address will export incorrectly.

### Also missing: private-relay detection

There is **no handling of `@privaterelay.appleid.com` anywhere in the codebase**. At minimum, a relay address should never be written into an email-keyed document path or treated as a reachable contact address — it is routable for transactional email but is not the address the family knows the person by, and writing it into `inviteLookup/` or `members/{email}` creates junk documents that the Stale Invites panel will later have to clean up.

### Phase 2 order of operations

1. Add a general Firestore rules test suite covering current membership/chore-completion behavior — the safety net for everything below.
2. Stop *creating* new email-keyed docs: invitations get a generated id plus an expiring token (option A), and `inviteLookup/{email}` stops being the join mechanism.
3. Add private-relay detection; never persist a relay address as a member email or document key.
4. Backfill existing email-keyed member docs to uid-keyed, and rewrite `assigneeIds` email references.
5. Only then drop `request.auth.token.email` from the rules.
6. Remove the email alias from `buildFamilyMemberAliasMap` last, once nothing depends on it.

Steps 1–3 are safe to do now and are what stop the bleeding. Steps 4–6 are a migration and want their own plan.

## Phase 2 part 1 — what shipped (2026-08-13)

Steps 1–3 above are done. Nothing existing was migrated or removed; this pass is
purely additive.

- **Rules test suite** (`apps/web/tests/rules/`, `npm run test:rules`). 31 tests
  against the Firestore emulator pinning membership resolution (uid-keyed and
  email-keyed), invite claiming, `inviteLookup` access, and chore-completion
  authorization including `assigneeId`/`assigneeIds` email matching and
  cross-family denial. Two tests deliberately pin the *broken* private-relay
  behavior so the migration has to consciously change them.
- **Invite codes** (`lib/family/invite-tokens.ts`, `invite-repository.ts`,
  `invite-redemption.ts`). Every invitation now also gets an invite id and a
  single-use 12-character Crockford-base32 code, stored only as a SHA-256 hash in
  a new server-only `familyInvites` collection, expiring in 30 days with an
  attempt lockout. The same code is what `/join?code=…` carries.
- **Redemption** via `POST /api/family/invitations/redeem` (web) and
  `POST /api/v1/families/join` (mobile). It compares no email addresses at all.
  Membership is written uid-keyed with admin credentials, because the redeemer is
  by definition not yet a member of the family.
- **Private-relay detection** (`lib/auth/private-relay.ts`) applied at every site
  that keyed or persisted a normalized email. A relay address is never a document
  key and never the family-visible address; it survives as `contactEmail` only.

### Corrections to the audit above

- The audit said "nine call sites across six route files". The actual count of
  sites that *key or persist* on a normalized email is **seven across five
  files**: `api/family/members`, `api/family/members/[memberId]` (revoke),
  `api/family/members/[memberId]/reinvite` (twice), `api/family/invitations/accept`,
  `api/family/summary`, and `lib/auth/idp-signin`. Alias *matching* sites are more
  numerous but do not persist anything.
- The audit's rules line numbers have drifted: `memberDocPathByEmail` is line 63,
  the member-id pair is 133–139, player self-completion is 121–131 and 645–658,
  and the member-doc email constraint is 343–364.
- Adding a rules test suite was assumed to be a large lift. It was not: Java 17 is
  already installed and `firebase-tools@13` runs the emulator on it. Only the
  current firebase-tools 15.x requires Java 21, so the CLI is pinned as a
  devDependency rather than requiring a JDK upgrade.

### What the follow-up migration pass still has to do

1. Backfill existing `members/{email}` docs to `members/{uid}` for members who
   have a known uid, soft-deleting the email-keyed original. Members with no uid
   yet (genuinely pending invites) must keep their email-keyed doc until they
   redeem.
2. Rewrite `assigneeId` / `assigneeIds` entries that hold an email address to the
   corresponding uid, across `chores` and `routineAssignments`. This is the step
   the rules tests exist to protect: get it wrong and a child silently loses the
   ability to complete their own chores.
3. Retire `inviteLookup/{email}` once nothing reads it — currently
   `idp-signin`, `api/family/summary`, and `api/family/invitations/accept` do.
4. Only then drop `request.auth.token.email` from `firestore.rules`
   (`memberDocPathByEmail`, `hasEmailMemberDoc`, `hasClaimableEmailInvite`,
   `isRequesterAssigneeId`, `requesterMemberIdsForFamily`,
   `requesterMatchesChoreAssignee`, and the `isFamilyAdmin` email branch), and
   flip the two private-relay tests in the rules suite from denied to allowed.
5. Remove the email alias from `buildFamilyMemberAliasMap` last.
6. Fix `api/family/privacy/export` member matching, which still matches by email.

## Open decisions

- Does Sign in with Apple appear on **web** too, or iOS only? (Recommend both — it keeps one account model, and a user who signs up on iOS with Apple otherwise cannot get back into their family on the web app at all.)
- Ship Phase 1 alone to unblock submission and follow with Phase 2, or hold submission until the invite model is fixed? (Recommend not shipping Phase 1 alone to real users: it makes the silent-empty-family bug reachable by every Apple user. Phase 1 alone is fine for TestFlight.)
