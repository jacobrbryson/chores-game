# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from `apps/web/` unless noted.

```bash
# Web dev server (port 3000)
npm run dev

# WebSocket server (port 3001) — run from apps/ws/
npm run dev

# Mobile (Expo) — run from apps/mobile/
npm run dev

# Type check (preferred over lint — ESLint config is currently broken)
npm run typecheck

# Run all tests
npm run test

# Run a single test file
npx vitest run src/lib/privacy/service.test.ts

# Build
npm run build
```

Do not use `npm run lint` — ESLint is currently broken in this project. Use `tsc --noEmit` to validate types.

## Monorepo Structure

```
apps/web/          Next.js app (primary — API routes, web UI)
apps/ws/           Socket.io WebSocket server
apps/mobile/       Expo React Native app
packages/locales/  Shared locale JSON (en-US, es-US, fr-FR)
packages/core/     Shared domain types/utilities
packages/api-client/  Typed API client for mobile
```

`apps/web` has its own local copy of `packages/locales` at `apps/web/packages/locales/`. **Locale JSON lives in two manually-synced locations** — always edit both `packages/locales/src/` and `apps/web/packages/locales/src/` in the same change.

## Database: Firestore via REST

The web app does **not** use the Firebase SDK. All Firestore reads/writes go through the Firestore REST API using two credential layers:

- **User-scoped** (`apps/web/src/lib/firestore/rest.ts`): uses the user's Firebase ID token from the `session_user` cookie. Used in most API routes.
- **Admin/service-account** (`apps/web/src/lib/firestore/admin.ts`): uses a service account JWT or GCP metadata credentials. Used in support-console routes and any cross-family operation. Functions are prefixed `admin*` (e.g. `adminListDocuments`, `adminRunQuery`, `adminDeleteDocument`).

Helper field builders (`stringField`, `timestampField`, `booleanField`, `integerField`) are in `rest.ts`. Use them — Firestore REST fields must be typed wrappers, not raw JSON values.

## Auth Flow

1. Google Sign-In posts to `POST /api/auth/google/gsi`
2. Server verifies the Google ID token and exchanges it with Firebase Identity Toolkit (`signInWithIdp`)
3. A signed HMAC HTTP-only cookie `session_user` is set with `{ uid, email, name, role, firebaseIdToken, firebaseRefreshToken }`
4. Protected routes call `getSessionFromRequest(request)` → `runWithRefreshedFirebaseToken(session, callback)` which auto-refreshes the Firebase ID token on 401 and rotates the cookie

Role values are `admin` (parent) and `player` (child). All protected mutations check role server-side via `getViewerRole()` in `apps/web/src/lib/family/access.ts`.

## Key Architectural Patterns

### API Routes (`apps/web/src/app/api/`)
- Every protected route calls `getSessionFromRequest` then `runWithRefreshedFirebaseToken`
- Family ID is resolved via `getPrimaryFamilyId(uid, idToken)` (reads `users/{uid}.familyIds[0]`)
- Role is checked via `getViewerRole(familyId, uid, idToken)`
- Common error helpers: `jsonUnauthorized()`, `jsonReauthRequired()`, `mapCommonFirestoreErrors()`

### Audit Logging
Important state changes write an immutable audit record via `writeAuditLogBestEffort()` (`apps/web/src/lib/audit/log.ts`) to `families/{familyId}/auditLogs/{id}`. Never omit audit logs for privacy, consent, wallet, or chore-status changes.

### Notifications / Realtime
Family activity events write to `families/{familyId}/notifications/{id}` via `emitFamilyActivity()` in `apps/web/src/lib/notifications/events.ts`. The WebSocket server at `apps/ws/` publishes `family:activity` events to connected clients. The **Family Activity Feed** (`/api/feed`) is a curated projection over these notification records — do not write separate feed events.

### Localization
All user-facing strings must use locale keys. The resolution order is: user locale → family default locale → `en-US`. Supported locales: `fr-FR`, `en-US`, `es-US` (in that order of priority for new keys). Locale keys live in `packages/locales/src/*.json` (and the duplicate at `apps/web/packages/locales/src/`).

### Mobile API Layer
Mobile uses versioned proxy routes at `/api/v1/*` that forward to internal `/api/*` routes. When adding a new endpoint, check whether a `/api/v1/` proxy is needed for mobile parity.

### Shared UI Components
- `Alert` — all error/warning/info banners; never use one-off markup
- `Button` — all interactive buttons
- `ModalShell` — all modals (bottom-sheet on mobile)
- `TailwindSelect` / `TailwindMultiSelect` — all dropdowns; renders in a `document.body` portal to avoid overflow clipping
- `CoinIcon`, `AppTabs`, breadcrumb — shared across web and mobile

## Privacy & Consent

Privacy state lives on the **family document** (`families/{familyId}`), not a separate collection:
- `acceptedTermsVersion`, `acceptedPrivacyVersion`, `parentalConsentAt`, `dataRegion`
- Current version constants: `CURRENT_TERMS_VERSION` / `CURRENT_PRIVACY_VERSION` in `apps/web/src/lib/privacy/config.ts` (env-overridable, default `"2026-06-06"`)
- `consentUpToDate` is derived by comparing stored versions to current constants

All `/api/family/privacy/*` routes require `admin` role (players/children get 403). Privacy actions (consent, export, deletion request) write to `PRIVACY_AUDIT_EVENTS` audit log entries via `writeAuditLogBestEffort`.

Deletion is **never immediate** — it schedules 30 days out (`DELETION_GRACE_PERIOD_DAYS`). Actual purge is not yet implemented.

## Support Console (`/support`)

Gated by `SUPPORT_ADMIN_EMAILS` and `SUPPORT_ADMIN_UIDS` environment variables via `isSupportAdmin()` in `apps/web/src/lib/support/access.ts`. Support routes use admin Firestore credentials and can read across all families. Regular family admins are not support operators.

Support API routes live at `apps/web/src/app/api/support/`. The UI is modular: `SupportConsoleShell` + per-module panel components in `apps/web/src/components/support-*.tsx`.

## Changelog

Any user-facing feature or fix must add an entry to `apps/web/src/data/change-log.json`. Fields required: `image`, `date`, `type`, `subject`, `description`. Changelog labels must be localized in all three locale files. Do not edit `sitemap.ts` — it reads the changelog JSON automatically.

## Data Constraints to Know

- Family member cap: 100 non-deleted members
- Active chores cap per assignee: 100
- Wallet balance cannot go negative; all mutations go through `users/{uid}/walletLedger`
- Invited member docs use email as the document ID (`members/{email}`); accepted members use UID (`members/{uid}`)
- Stale invite cleanup: when a user accepts an invite, their email-keyed doc becomes a stale orphan — the support console's Stale Invites panel handles cleanup
