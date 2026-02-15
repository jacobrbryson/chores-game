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
- Add tests for workflow-critical behavior:
  - chore status transitions
  - approval/rejection permissions
  - currency payout
  - purchase flow and insufficient funds
- Avoid breaking changes to API contracts without updating this file.

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
