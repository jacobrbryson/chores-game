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
  - `GET /api/chores` returns all chores for the signed-in user's primary family plus `viewerRole` for permission-aware UI actions.
  - `POST /api/chores` creates one or more chores from a list of titles (admin-only).
  - `GET /api/chores/suggestions` returns up to 100 chore description suggestions ranked by family usage then global usage; with `q` (3+ chars), suggestions are filtered by character match.
  - `DELETE /api/chores/{choreId}` performs a soft delete (`deleted=true`, timestamped).
- Add Chores dialog UX:
  - Primary required field is `Description` with autocomplete suggestions.
  - `Assignee` selector loads current family members.
  - `Additional Options` toggles due date and details fields.
- Chore list UX:
  - Non-empty chore lists include an `Add more chores` CTA at the bottom.
  - Chore rows include coin display and a remove (`X`) action with tooltip.
  - `/chores` table row actions now use a three-dot options menu with `Edit`, `Delete` (confirmation), and `Undo completion`.
  - `/chores` table status displays `Completed` for chores in `Submitted` state and includes a `Completed Date` column.
  - Chore creation UI controls (including `+` and add-chores CTAs) are shown only to users allowed to create chores.
- If a logged-in user has no family, homepage dashboard shows a "Get Started" add-member flow.
- Firebase ID token handling:
  - Session stores Firebase refresh token in signed HTTP-only `session_user` cookie payload.
  - Protected API routes auto-refresh Firebase ID tokens on `401` from Firestore and rotate `session_user` cookie.
- Firestore security rules baseline is now collection-scoped (no global authenticated read/write):
  - `users/{uid}` only accessible by that user.
  - `families/{familyId}` readable by family members, writable by family admins.
  - `families/{familyId}/members` readable by family members; create/update/delete by family admins, with bootstrap exception for family creator's first admin membership doc.
  - `families/{familyId}/chores` readable by family members; create/delete by family admins; update by family admins, plus a restricted player self-submit path (`Open` -> `Submitted` with only `status`, `submittedAt`, `updatedAt` changed).
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
  - Invite acceptance now supports legacy invites where `members/{email}.role` is missing (defaults claim role to `player`) and allows invited users to activate an existing `members/{uid}` doc from `invited` -> `active`.
  - Accept-invite now falls back to a claimable `members/{uid}` invite doc when `members/{email}` is missing and emits structured `[ACCEPT_INVITE_DEBUG]` logs per step (family resolution, invite lookup, member upsert/relink).
- Chore panel and dialog updates (2026-02-21):
  - Home "Today's Chores" section is split into dedicated components (`TodayChoresPanel` + per-chore card component).
  - Chore row actions now use a three-dot menu with `Edit` and `Delete` options.
  - Chore create/edit uses one shared component: `AddEditChoresDialog`.
  - Added `PATCH /api/chores/{choreId}` for:
    - `action: "edit"` to update chore details (title, assignee, due date, details).
    - `action: "complete"` to mark chore as `Submitted`.
    - `action: "undo_complete"` to move completed chores (`Submitted`/`Approved`) back to `Open`.
  - Chore action permissions are role-aware:
    - `player` users cannot create chores.
    - `player` users cannot edit chores.
    - `player` users cannot delete chores.
    - `player` users cannot undo completion.
    - `player` users can only mark chores as complete when assigned to themselves.
    - `admin` users retain full chore action access.
  - Chore cards now include a prominent `Mark as Complete` action; completed chores leave the "Today's Chores" list.
  - Modal/popup interactions now use a shared animated shell for quick slide-up on open and slide-down on dismiss.
  - Home "Today's Chores" now includes a right-side animated completion chart by family member.
  - Chart timeframe dropdown defaults to `Today` and supports `This Week`, `This Month`, and `This Year`.
  - Added `GET /api/chores/completion-stats?window=today|week|month|year` to return completed chore counts (`Submitted`/`Approved`) per active family member.
  - Added optional `tzOffsetMinutes` query support on `GET /api/chores/completion-stats` so timeframe bucketing aligns with the viewer's local timezone.
  - Completion chart includes a second line graph under the bars that follows the selected timeframe filter.
  - `GET /api/chores/completion-stats` now returns `trend` series data for the selected window with bucket granularity:
    - `today`: hourly points
    - `week`: daily points
    - `month`: daily points
    - `year`: weekly points
- Family management and landing updates (2026-02-21):
  - Logged-in homepage is chores-first; "Today's Chores" is the primary default content.
  - Home no longer renders the members management card.
  - Home member count line links to `/family`.
  - `/family` is now the dedicated family management page (list, add, re-invite, remove members).
  - Home chores view removes extra heading/member-count wrapper for a cleaner surface.
  - Profile dropdown now includes a `Manage Family` link above `Logout`.
  - Profile dropdown is now a controlled popover that closes on outside click/tap and includes a visual divider between `Manage Family` and `Logout`.
  - Home chores panel now supports a persistent `My Chores` toggle that filters to the signed-in user and shows `My Chores (x) out of (y)` counts.
  - Introduced reusable menu-action link styling/component used by profile dropdown actions and home `All Chores` action.
  - `My Chores` preference is now persisted in Firestore on `users/{uid}.preferencesMyChoresOnly` via `GET/PATCH /api/preferences`, with localStorage fallback.
  - Added reusable `Button` component and migrated app UI button usage to it for consistency.
- Invite acceptance rules update (2026-02-22):
  - Firestore `members/{memberId}` claim checks no longer depend on `request.auth.token.email` being present for UID-based invites.
  - UID invite claim is now allowed on both create and update paths when the signed-in user is claiming their own UID member doc with role/email-consistent data and `status == "active"`.
- Notifications and audit activity updates (2026-02-22):
  - Added `GET/PATCH /api/notifications`.
    - `GET /api/notifications` returns family activity notifications visible to the signed-in user (`admins`: all family activity, `players`: only related activity).
    - `GET /api/notifications?summary=count` returns unseen activity count for badge UI.
    - `GET /api/notifications?unseen=true` filters to unseen activity.
    - `PATCH /api/notifications` marks a list of notification IDs as seen for the signed-in user.
  - Added `/notifications` page with filter controls (`Unseen`, `All`).
  - Profile avatar/menu now displays red unseen-count badges and links to `/notifications?unseen=true`.
  - Chore API activity now writes immutable family activity docs at `families/{familyId}/notifications/{notificationId}` for create/edit/delete/complete/undo-complete actions.
  - Per-user seen state is stored in `families/{familyId}/notificationSeen/{uid_notificationId}`.
- Realtime websocket activity updates (2026-02-22):
  - Websocket server now supports authenticated internal publishing endpoint: `POST /events/family-activity`.
  - Internal publish calls are authenticated with `WS_INTERNAL_SECRET`.
  - Chore API now publishes realtime `family:activity` events for create/update/delete/complete actions.
  - Home dashboard (`FamilyCard`) subscribes to family activity and refreshes chores, chart data, and notification badge state.
  - `/chores` page subscribes to family activity and refreshes the table rows in realtime.
  - New env vars for realtime publish path:
    - `NEXT_PUBLIC_WS_URL` (single websocket base URL used by both browser socket connections and server-side publish calls, e.g. `http://localhost:3001`)
    - `WS_INTERNAL_SECRET` (shared secret configured in both web and ws apps)
  - Firebase App Hosting now runs as two separate backends:
    - `api-chores-game` for `apps/web` (Next.js app + API routes)
    - `ws-chores-game` for `apps/ws` (socket.io server + `/events/family-activity`)
  - `apps/web/apphosting.yaml` now expects runtime secret `WS_INTERNAL_SECRET` and build/runtime secret `NEXT_PUBLIC_WS_URL`.
  - `apps/ws/apphosting.yaml` now expects `WS_ORIGIN` and `WS_INTERNAL_SECRET`; `WS_ORIGIN` can be a comma-separated allowlist and should include the deployed web app origin.
- Layout shell/header updates (2026-02-22):
  - Top navigation (`Family Chores` brand + auth/profile menu container) moved into app layout and now persists across all pages.
  - Shared header rendering uses `session_user` cookie in layout to show either Google sign-in or profile menu consistently on all routes.
  - Profile menu now includes a `Profile` link that routes to `/profile`.
  - Added `/profile` page showing avatar (stored avatar, Google photo, or default user icon fallback), name, email, role, and theme (`gray + white` default when unset).
- Store/economy updates (2026-02-22):
  - Added `/store` page and `GET/POST /api/store`.
  - Header now shows a coins + `Store` chip to the left of profile menu.
  - Chore completion (`action: "complete"`) now credits the assignee wallet by `coinValue`.
  - Undo completion (`action: "undo_complete"`) now debits the assignee wallet by `coinValue` and blocks transitions that would push wallet below zero.
  - Wallet ledger entries are written at `users/{uid}/walletLedger/{entryId}` for payout, undo, and store purchases.
  - Store starts with three items:
    - `Customize colors` (30 coins)
    - `Customize avatar` (50 coins)
    - `Victory confetti` (20 coins)
  - Color customization writes `dashboardPrimaryColor` on `families/{familyId}/members/{uid}` and blocks selecting colors already used by other family members.
  - Completion chart colors now use member `dashboardPrimaryColor` when present.
  - Avatar customization supports a default pack placeholder at `public/avatars/default/` with expected filenames `avatar-01.png` through `avatar-20.png`.
- Limits and pagination updates (2026-02-22):
  - Family member cap is enforced in backend: max 100 non-deleted members per family.
  - Active chores cap is enforced in backend: max 100 non-deleted chores per assignee.
    - Enforced on chore create and chore edit/reassignment paths.
  - `GET /api/chores` now supports paging with `page` and `limit` query params (`limit` max 100) and returns pagination metadata.
  - `GET /api/notifications` now supports paging with `page` and `limit` query params (`limit` max 100) and returns pagination metadata.
  - `/chores` and `/notifications` UI now include pager controls (previous/next) backed by the paged API responses.
  - `/chores` and `/notifications` now support server-backed table search (`q`) with 3+ character threshold and column sorting (`sortBy`, `sortDir`).
  - Table UIs debounce search input and guard against out-of-order HTTP responses using request cancellation and request-sequence checks.

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
