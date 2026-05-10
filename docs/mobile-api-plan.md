# Mobile/API Foundation Plan

## Architecture overview
- Keep existing Next.js web app behavior intact.
- Add internal versioned API surface at `/api/v1/*` in the web app.
- Reuse current auth/session + Firestore access through thin adapter routes.
- Add shared TypeScript contracts and client packages for web/mobile reuse.
- Add Expo React Native scaffold app that consumes shared client.

## Why API-first
- Enables mobile and web to share endpoint contracts.
- Keeps business rules server-authoritative.
- Allows future public API hardening without rewriting product logic.

## Shared database decision
- Firestore remains the single source of truth.
- `/api/v1` proxies/wraps existing route handlers to preserve current permission rules.

## API versioning plan
- Private/internal API namespace starts with `v1`.
- Existing `/api/*` routes remain unchanged for web compatibility.
- Future versions can evolve contract shape without breaking current web routes.

## Auth assumptions
- Current session cookie (`session_user`) remains primary auth for web routes.
- Mobile token integration is TODO; client supports optional access token injection.

## Mobile roadmap
- Current pass: Expo scaffold + tabs + basic fetch states.
- Next: production auth, profile switching parity, optimistic chore UX, push notifications.
- Later: richer quest/avatar visuals and optional Unity embedding.

## Future public API gating
- API keys for trusted server apps.
- OAuth/service accounts for third-party integrations.
- Endpoint allowlist per client type.
- Rate limiting and abuse controls.
- Audit logs for sensitive mutations.
- Separate external developer docs portal.

## Completed scaffold endpoints
- GET `/api/v1/health`
- GET `/api/v1/me`
- GET `/api/v1/families/current`
- GET/POST `/api/v1/chores`
- POST `/api/v1/chores/:id/complete`
- POST `/api/v1/chores/:id/approve`
- GET `/api/v1/rewards`
- POST `/api/v1/rewards/:id/redeem`
- GET `/api/v1/quests`
- GET `/api/v1/quests/:id`
- POST `/api/v1/quests/:id/start`
- POST `/api/v1/quests/:id/choice`
- GET `/api/v1/achievements`
- GET `/api/v1/notifications`

## TODO endpoints
- Strongly typed request/response mapping per domain (beyond adapters).
- Dedicated v1 mutation handlers for store and family awards domain.
- OpenAPI generation pipeline from contracts.
- Mobile auth + secure token refresh flow.
- Expand paginated/filterable query contracts for quests/rewards/achievements.
