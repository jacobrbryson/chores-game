# AGENTS.md

## Purpose
This file defines what this project is trying to accomplish and the operating rules for contributors (human and AI agents). Treat it as a living document and update it as decisions are made.

## Product Goal
Build a family chore game where:
- Parents manage chores, approvals, and rewards.
- Kids complete chores, earn virtual currency after approval, and spend it on cosmetic avatar items.

## Primary Roles
- Parent (`admin`)
  - Creates and assigns chores/checklists.
  - Reviews submitted chores and approves or rejects them.
  - Manages reward/store catalog.
- Kid (`player`)
  - Signs in with Google.
  - Views assigned chores.
  - Submits chores as complete.
  - Earns currency when submissions are approved.
  - Purchases and equips cosmetics.

## Core Requirements (MVP)
1. Authentication
   - Google auth for kids and parents.
   - Role-based access (`admin`, `player`) enforced in backend and UI routing.
2. Chore Workflow
   - Chore states: `Open -> Submitted -> Approved | Rejected`.
   - Only parents can approve/reject.
   - Rejections should include optional feedback.
3. Parent Notifications
   - Notify parent when a kid submits a chore.
   - MVP can start with in-app notifications; external channels (email/push) are optional follow-up.
4. Economy
   - Virtual currency balance per kid account.
   - Balance increases only on approved submissions.
   - All balance mutations must be auditable.
5. Shop + Inventory
   - Parent-configurable cosmetic items with price and availability.
   - Kids can purchase items if balance is sufficient.
   - Purchased items are stored in inventory and can be equipped.
6. Avatar/Cosmetics
   - Kid avatar supports cosmetic slots (for example: hat, outfit, accessory).
   - Equipped cosmetics persist per user.

## Domain Rules
- Approval is the single trigger for payout.
- A chore submission can only be approved/rejected once per submission event.
- Currency cannot go negative.
- Purchase operations must be atomic (deduct balance + grant item together).
- Role checks are mandatory on all protected API operations.

## Engineering Rules
- Keep business logic in shared/domain modules, not only UI handlers.
- Validate all incoming API payloads.
- Prefer explicit enums/constants for statuses and roles.
- Keep source files small and focused. Target a max of ~400 lines per file; split large files by feature/component.
- Add tests for workflow-critical behavior:
  - chore status transitions
  - approval/rejection permissions
  - currency payout
  - purchase flow and insufficient funds
- Avoid breaking changes to API contracts without updating this file.

## Recent Decisions (2026-02-15)
- Homepage is the primary auth entry point; the standalone `/login` page was removed.
- Google sign-in uses Google Identity Services button on homepage and posts to `/api/auth/google/gsi`.
- Auth callback now redirects with `303` to avoid stale POST behavior after sign-in/logout.
- A `session_user` HTTP-only cookie is set after successful sign-in and used to render profile state in navbar.
- `session_user` is now a signed cookie (HMAC) with expiry; unsigned/invalid cookies are treated as anonymous.
- Navbar behavior:
  - Logged out: show Google sign-in button.
  - Logged in: show profile avatar with dropdown and logout action.
- Logout endpoint: `POST /api/auth/logout` clears `session_user` and redirects home (`GET` not supported).
- Firestore persistence path (current implementation):
  - Verify Google ID token.
  - Exchange with Firebase Identity Toolkit (`signInWithIdp`).
  - Upsert user record in `users/{uid}` with role defaulting to `player`.
- Environment variables currently expected by web auth flow:
  - `GOOGLE_CLIENT_ID`
  - `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
  - `FIREBASE_PROJECT_ID`
  - `FIREBASE_WEB_API_KEY`
  - `SESSION_SECRET` (>= 32 chars)
- Homepage view split by auth state:
  - Logged out users see the marketing hero + "How it works".
  - Logged in users see a "My Family" dashboard card instead of the hero.
- New authenticated family APIs:
  - `GET /api/family/summary` returns family snapshot (members + chores due today).
  - `POST /api/family/members` creates a family automatically if needed, then adds a member.
  - `DELETE /api/family/members/{memberId}` removes a non-self family member.
  - `POST /api/family/members/{memberId}/reinvite` marks a non-self member as re-invited.
  - `POST /api/family/invitations/accept` lets an invited member accept and activate their own family membership.
- New chores browsing/creation flow:
  - Home "Today's Chores" includes `All Chores` link to `/chores`.
  - `/chores` shows all chores in a table and an empty-state CTA.
  - Shared CTA button text is `Let's add some!` and opens the same add-chores dialog.
- New chores API:
  - `GET /api/chores` returns all chores for the signed-in user's primary family.
  - `POST /api/chores` creates one or more chores from a list of titles.
  - `GET /api/chores/suggestions` returns up to 100 chore description suggestions ranked by family usage then global usage; with `q` (3+ chars), suggestions are filtered by character match.
  - `DELETE /api/chores/{choreId}` performs a soft delete (`deleted=true`, timestamped).
- Add Chores dialog UX:
  - Primary required field is `Description` with autocomplete suggestions.
  - `Assignee` selector loads current family members.
  - `Additional Options` toggles due date and details fields.
- Chore list UX:
  - Non-empty chore lists include an `Add more chores` CTA at the bottom.
  - Chore rows include coin display and a remove (`X`) action with tooltip.
- If a logged-in user has no family, homepage dashboard shows a "Get Started" add-member flow.
- Firebase ID token handling:
  - Session stores Firebase refresh token in signed HTTP-only `session_user` cookie payload.
  - Protected API routes auto-refresh Firebase ID tokens on `401` from Firestore and rotate `session_user` cookie.
- Firestore security rules baseline is now collection-scoped (no global authenticated read/write):
  - `users/{uid}` only accessible by that user.
  - `families/{familyId}` readable by family members, writable by family admins.
  - `families/{familyId}/members` readable by family members; create/update/delete by family admins, with bootstrap exception for family creator's first admin membership doc.
  - `families/{familyId}/chores` readable by family members, writable by family admins.
- Invite/member resolution updates (2026-02-16):
  - New invites use the normalized invitee email as `members/{memberId}` when email is provided.
  - Family summary recovery now falls back to member-email lookup when `familyIds` and UID-based membership lookup are missing.
  - Re-invite migrates legacy random-ID invite docs (no `uid`) to the email-keyed member doc and soft-deletes the legacy doc.
  - Firestore rules treat an email-keyed member doc as valid family membership (non-deleted), while admin checks remain UID-doc based.
  - Google sign-in now auto-links an invited user to the matching family by email and writes `users/{uid}.familyIds` on login when missing.
  - Google sign-in now also auto-claims the invite by creating/updating `families/{familyId}/members/{uid}` as `active` from the email-keyed invite record.
  - Family summary de-duplicates legacy email-only invite records when a UID-linked member with the same email exists.
  - Firestore rules now allow a signed-in invitee to create their own UID member doc from a claimable email invite.
  - Invite linking now writes an explicit index doc at `inviteLookup/{email}` with `{ familyId, status }` to avoid collection-group lookup failures.
  - Child sign-in and family summary recovery now read `inviteLookup/{email}` first, then fall back to member queries.
- Pending invite UX: invited users see only inviter context + an accept action until they accept; full family members and chores are shown only after acceptance.
  - Member-management permissions tightened: only `admin` members can re-invite or remove family members; `player` users cannot perform these actions in UI or API.

## Suggested Initial Component Mapping
- Auth module: Google sign-in, session handling, role mapping.
- Chores module: CRUD, assignment, submission, approval pipeline.
- Notifications module: parent notification generation and read state.
- Economy module: wallet ledger + balance projection.
- Shop module: catalog, purchasing, inventory, equip/unequip.
- Avatar module: cosmetic slot config + active loadout.

## Definition of Done (Feature-Level)
- Role-safe end-to-end flow works in UI and backend.
- Error states are handled (unauthorized, invalid transition, insufficient funds).
- Tests cover critical business rules.
- Documentation updated in `AGENTS.md` when behavior or rules change.
