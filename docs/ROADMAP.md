# Roadmap

Living document. Tracks the remaining work items ahead of and after public launch.
`AGENTS.md` holds the durable rules and the decision log; this file holds *what's next*.

Last updated: 2026-08-10

## Status legend

| Status | Meaning |
| --- | --- |
| `Not started` | No code or assets exist yet |
| `Partial` | Foundations shipped, feature incomplete |
| `In progress` | Actively being built |
| `Blocked` | Waiting on an external dependency (store review, account setup, assets) |
| `Done` | Shipped and verified |

## Snapshot

| # | Item | Status | Type | Blocking launch? |
| --- | --- | --- | --- | --- |
| 1 | Android app on Google Play | Not started | Release ops | Yes |
| 2 | iOS app on the App Store | Not started | Release ops | Yes |
| 3 | YouTube product demo videos | Not started | Marketing | No |
| 4 | Family invite / referral build-out | Partial | Product | No |
| 5 | Friend high-fives, shout-outs, cross-family prizes | Not started | Product | No |
| 6 | Website refresh — fun, animated, game-like | Not started | Product/design | No |
| 7 | Family leveling / progressive feature unlock | Not started | Product (cross-cutting) | No |

Items 1 and 2 are sequential-ish gating work with external review latency; 3–7 can proceed in parallel.
Suggested order: **1 → 2** (start immediately, long lead times) with **6** running alongside, then **7 → 4 → 5**, and **3** once the refreshed UI from 6 exists to film.

**Item 7 is a cross-cutting dependency and should be designed before 4, 5, and the kid-facing half of 6.** It decides which surfaces are visible to which families, so item 4's referral incentives, item 5's cross-family features, and item 6's celebration moments all want to know about it. Its ladder design (which feature unlocks when) is also the cheapest thing on this roadmap to get wrong and the most expensive to change later, because unlock order becomes a promise to existing families.

---

## 1. Android app on Google Play

**Status:** Not started · **Owner:** TBD

The Expo app runs locally (`apps/mobile`, Expo 54 / RN 0.81) but nothing about release builds or store submission exists yet.

### Current state
- `apps/mobile/app.config.js` sets `android.package = com.orcwood.familychores`, icons, adaptive icon, and splash.
- **No `apps/mobile/eas.json`** — there is no build profile, no submit profile, no credentials configuration.
- No Play Store listing assets (feature graphic, phone/tablet screenshots, short/full description).
- No release signing configuration or Play App Signing enrollment.
- Sign-in requires `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` and server-side `GOOGLE_ANDROID_CLIENT_ID`; the release build's SHA-1 must be registered in the Google Cloud OAuth client or Google Sign-In will fail only in production.

### Known issue to fix first
Root `app.json` declares `android.package = "com.anonymous.choresgame"`, which conflicts with the real package id in `apps/mobile/app.config.js` (`com.orcwood.familychores`). Reconcile or delete the stale root file before generating any release build — a wrong package id on a published app is unfixable without a new listing.

### Work
- [ ] Reconcile/remove the conflicting root `app.json` package id.
- [ ] Create Google Play Console developer account; complete identity verification (can take days).
- [ ] Add `apps/mobile/eas.json` with `development` / `preview` / `production` build profiles and a `submit` profile.
- [ ] Configure Android release credentials (prefer EAS-managed keystore + Play App Signing).
- [ ] Register the release SHA-1/SHA-256 with the Android OAuth client so Google Sign-In works in the production build.
- [ ] Produce an internal-testing AAB and verify: Google Sign-In, family summary, chore complete/approve, wallet, realtime feed, deep links (`familychores://`), and locale switching (`fr-FR`/`en-US`/`es-US`).
- [ ] Complete the Play Data Safety form. Must match the actual data model — this app handles `CHILD_SENSITIVE` data (child names, avatars, activity history).
- [ ] Complete Play's **Families / Designed for Families** policy questionnaire and target-audience declaration. A kids-inclusive audience triggers extra requirements: no ads SDKs, restricted data collection, verified content rating.
- [ ] Content rating questionnaire (IARC).
- [ ] Store listing: title, short description, full description, feature graphic (1024×500), phone + 7"/10" tablet screenshots, app icon (512×512).
- [ ] Point the listing's privacy policy URL at the live `/privacy-policy` route.
- [ ] Internal testing track → closed testing → production rollout.

### Risks
- Play's Families policy review is the most likely source of delay; account/identity verification and content-rating review add days.
- Data Safety declarations must stay in sync with the privacy documentation or the listing gets rejected.

### Acceptance
Production build available on the Play Store; sign-in, chore lifecycle, and wallet verified on a real device from the store build (not a dev client).

---

## 2. iOS app on the App Store

**Status:** Not started · **Owner:** TBD

Same Expo codebase; `ios.bundleIdentifier = com.orcwood.familychores`.

### Current state
- No `eas.json` (shared blocker with item 1).
- No Apple Developer Program membership / App Store Connect app record.
- Google Sign-In on iOS depends on `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` and the reversed-client-id URL scheme already wired in `app.config.js`; server verification needs `GOOGLE_IOS_CLIENT_ID`.

### Work
- [ ] Apple Developer Program enrollment ($99/yr; individual vs. organization decision — organization requires a D-U-N-S number and takes longer).
- [ ] Create the App Store Connect app record with the matching bundle id.
- [ ] Add iOS build + submit profiles to `eas.json`; configure distribution certificate and provisioning profile (EAS-managed is fine).
- [ ] TestFlight internal build; verify the same checklist as Android plus Sign in with Apple considerations.
- [ ] **Decide on Sign in with Apple.** App Review guideline 4.8 requires an equivalent privacy-preserving login option when the app offers third-party sign-in (Google) as the *only* option. This is currently a Google-only app — expect rejection without it. Implementing it means a new auth path alongside `/api/auth/google/gsi` plus a Firebase Identity Toolkit provider. **This is the single largest engineering risk in items 1–2.**
- [ ] App Privacy ("nutrition label") questionnaire — must align with the Play Data Safety answers.
- [ ] Kids Category decision. Entering the Kids Category bans third-party analytics and advertising and requires a parental gate for external links/purchases; staying out of it but targeting families still triggers scrutiny under guideline 1.3.
- [ ] Age rating questionnaire.
- [ ] Screenshots for required device sizes (6.9"/6.5" iPhone, 13" iPad if iPad-supported), app icon, subtitle, promotional text, description, keywords.
- [ ] Privacy policy + terms URLs pointing at `/privacy-policy` and `/terms-of-service`.
- [ ] Demo account credentials for App Review (a seeded family with a parent and child account) — reviewers cannot get past Google Sign-In without one.
- [ ] Submit for review; budget for at least one rejection round.

### Risks
- Sign in with Apple (4.8) and the Kids Category rules are the two likeliest rejection causes.
- Reviewers need a working demo login; Google Sign-In in a review sandbox is a common failure point.

### Acceptance
App live on the App Store; TestFlight → production verified with the same functional checklist as item 1.

---

## 3. YouTube product demo videos

**Status:** Not started · **Owner:** TBD

Best sequenced *after* item 6 so the footage shows the refreshed UI rather than needing a reshoot.

### Proposed video set
| Video | Length | Audience | Content |
| --- | --- | --- | --- |
| Product overview / trailer | 60–90s | Everyone | The hook: chores → coins → rewards → avatar |
| Parent setup walkthrough | 3–5 min | Parents | Create family, invite members, add chores/routines, set coin values, approve work |
| Kid experience | 2–3 min | Parents (about kids) | Dashboard, completing a chore, confetti, wallet, store, avatar, achievements |
| Family Friends + Feed | 2–3 min | Parents | Connecting families, shared positive activity, Family Awards |
| Feature spotlights (series) | 60s each | Everyone | Routines, Pillars of Responsibility, Approval Inbox, Google Tasks sync, kiosk mode |

### Work
- [ ] Seed a demo family with realistic non-real data — **no real child names, photos, or emails on camera** (public-content rules in `AGENTS.md` apply to video too).
- [ ] Write scripts/storyboards per video.
- [ ] Screen recording setup (1080p or 4K, clean browser profile, consistent viewport size).
- [ ] Record web flows; record mobile flows on a device/simulator once items 1–2 produce stable builds.
- [ ] Edit: captions/subtitles (consider `fr-FR`/`es-US` subtitle tracks to match supported locales), music licensing, intro/outro.
- [ ] Thumbnails, titles, descriptions, chapters, end screens.
- [ ] Create/brand the YouTube channel; publish; embed the overview video on the marketing homepage and `/features`.

### Acceptance
Overview + parent walkthrough published and embedded on the marketing homepage.

---

## 4. Family invite / referral build-out

**Status:** Partial · **Owner:** TBD

Two distinct invite flows already exist and should not be conflated:
- **Member invites** (inside one family) — `POST /api/family/members`, email-keyed member docs, `inviteLookup/{email}`, `POST /api/family/invitations/accept`.
- **Family Friends** (family-to-family) — `apps/web/src/lib/family-friends/{model,repository,notify,audit}.ts`, `/api/family-friends/*` with `/api/v1` mobile proxies, expiring single-use confirmation tokens, admin-only, bilateral on confirmation.
  - Connected-family parents can copy Family Awards and routine templates from the Feed. Routine copy previews editable steps and coin settings, and can immediately assign separate occurrences to multiple active family members with a repeat schedule.

This item is about making **growth-oriented invitations** first-class on top of those: contact-assisted invites plus incentives.

### Proposed scope
1. **Contacts-assisted invite (admin only)**
   - Google People API integration to let a signed-in admin pick contacts to invite, instead of typing emails one at a time.
   - Precedent for the OAuth pattern already exists in `apps/web/src/lib/google/tasks-link.ts` / `tasks-api.ts` (incremental scope grant + token storage).
   - Scope: `contacts.readonly`, requested incrementally and never at sign-in.
   - **Hard constraints:** contacts are read on demand and never persisted beyond the invite record; no contact-graph building; imported names/emails are `ADMIN_ONLY`; requires an explicit consent screen explaining what is read and that nothing is stored. Google will require a verification review for a sensitive scope — budget for that.
   - Manual email entry stays as the always-available path (contacts import must never become the only route).
2. **Referral attribution**
   - Per-family referral code/link, redeemable at signup, recorded on the accepting family.
   - `AGENTS.md` already defines a `referral` entitlement type, but **no entitlements module exists in `apps/web/src/lib` yet** — this item either introduces the minimal entitlement store or explicitly defers it.
3. **Incentives**
   - Feeds the same reward pipeline as item 7's post-ladder XP (an accepted friend invite is the canonical XP award) — build one pipeline, not two.
   - New achievements in `apps/web/src/lib/achievements/catalog.ts` (static catalog, `metricType` + `target` + witty title + placeholder art), e.g. `admin_first_family_invited`, `admin_3_families_invited`, `player_first_friend_family`.
   - New `metricType`s (`families_invited`, `friend_families_connected`) wired through `lib/achievements/service.ts`.
   - Avatar/theme unlock granted on successful referral, delivered through the existing store unlock mechanism rather than a parallel one.
4. **Invite lifecycle UX**
   - Pending/accepted/expired states visible to the inviting admin, with resend and cancel (Family Friends already has resend/cancel; member invites have reinvite).
   - Stale-invite orphan cleanup already exists in the support console — verify the new flows don't create new orphan classes.

### Anti-goals
- No viral/spammy mechanics: no auto-inviting a whole contact list, no repeated nag emails, no rewards for *sending* invites (only for accepted connections) — otherwise the incentive becomes a spam incentive on a product used by children.
- No child-initiated invites. Invites stay admin-only, consistent with the existing Family Friends rule.

### Cross-cutting requirements
- Localize all new copy in `fr-FR` / `en-US` / `es-US`, in **both** `packages/locales/src/` and `apps/web/packages/locales/src/`.
- Mobile parity via `/api/v1/*` proxies (Family Friends already has them).
- Audit log every invite create/accept/cancel; classify referral records (`ADMIN_ONLY` for invited emails, `FAMILY_PRIVATE` for the resulting relationship).
- Support console visibility for referral/invite state.
- Changelog entry.

### Open questions
- Referral incentive for both sides, or only the referrer? (Recommend both — one-sided referral rewards read as spam bait.)
- Does a referral grant anything beyond cosmetics (e.g. future premium trial)?

### Acceptance
An admin can invite from contacts or by email, both sides see clear invite state, and an accepted family invite grants a visible achievement + cosmetic unlock — with an audit trail and support visibility.

---

## 5. Friend high-fives, shout-outs, and cross-family prizes

**Status:** Not started · **Owner:** TBD

Builds directly on Family Friends. Today connected families share only a read-only positive-activity projection; there is **no reaction, high-five, or message primitive anywhere in the codebase**.

### Proposed scope, in dependency order
1. **High-fives (reactions) — phase 1**
   - A lightweight, fixed-vocabulary reaction on a feed item (high-five, clap, star). No free text.
   - Storage on the notification/feed projection; the counter should be visible to the recipient family.
   - Works within a family first, then across connected families — same primitive, wider audience.
   - Recipients see "someone from the Smith family high-fived your chore" with first-name-only attribution, matching the existing cross-family display rule (first name + avatar only).
2. **Shout-outs — phase 2**
   - A parent-authored short message about a specific child (own family or a connected family's child), e.g. recognizing kindness.
   - **Free text crossing a family boundary about a child is the highest-risk surface in this roadmap.** Requirements: parent/admin authorship only, length cap, no links, recipient-parent visibility before the child sees it (or parent-approval gate), report/block, full audit, and a support moderation queue. Recommend routing shout-outs through the existing `supportRequests`-style moderation posture rather than inventing a new one.
   - Consider launching with **templated** shout-outs (pick from a localized phrase list) before free text — same emotional payoff, none of the moderation exposure. Recommended for V1.
3. **Cross-family prizes — phase 3**
   - Friend-created Family Awards can already be *copied* into a viewer's own awards (`/api/family-friends/awards/copy`). The natural extension: a parent grants a small award/coin bonus to a connected family's child, which the receiving parent must approve before it lands in the wallet.
   - **The receiving parent's approval is mandatory** — no external adult may move value into a child's wallet unilaterally. Wallet mutations continue through `users/{uid}/walletLedger` with audit.
4. **Recognition achievements**
   - "Kindness" achievements driven by received high-fives/shout-outs, keeping the incentive on being kind rather than on farming reactions (cap the countable per-sender contribution).

### Safety and privacy constraints (non-negotiable)
- Children never message children. All cross-family free text is parent-authored and parent-visible.
- No child last names, emails, photos, or family identifiers cross the boundary — first name + avatar only, as already established.
- Every cross-family write is audited; families can disable inbound shout-outs entirely; removing a friendship stops all of it.
- Rate limits on reactions and shout-outs (`lib/rate-limit` already exists).
- Data classification: reactions and shout-out content about a child are `CHILD_SENSITIVE`; moderation records are `ADMIN_ONLY`.

### Cross-cutting requirements
Localization ×3 in both locale copies · web + mobile parity (`/api/v1` proxies) · audit logging · support moderation surface · changelog entry.

### Acceptance
A parent can high-five a connected family's child's completed chore, the child's family sees the recognition attributed to a first name, and a parent can send a moderated shout-out — all auditable, rate-limited, and disableable per family.

---

## 6. Website refresh — fun, animated, game-like

**Status:** Not started · **Owner:** TBD

The functional surface is broad and complete; the visual language is closer to a competent SaaS dashboard than to a game. This item is a design pass, not a rewrite.

### Principles
- **Reuse, don't fork.** The shared components (`Alert`, `Button`, `ModalShell`, `TailwindSelect`, `CoinIcon`, `AppTabs`) are the right place for a visual refresh — restyle them once and every surface benefits. Do not introduce one-off styling per page.
- **Animate feedback, not navigation.** Celebrate completion, coin gain, level-up, and unlocks. Don't animate things users do a hundred times a day.
- **Respect `prefers-reduced-motion`** on every animation, with a real static fallback.
- **Performance budget.** No animation library that meaningfully hurts LCP/INP on the dashboard or on low-end Android.
- Keep parent-facing management surfaces (approvals, family management, support) calm and legible; concentrate the playfulness in kid-facing surfaces.

### Candidate work
- [ ] Define the visual direction first: palette, illustration style, typography, motion vocabulary (durations/easings as tokens). One decision doc + a sample screen before any broad implementation.
- [ ] Refresh the marketing homepage / hero — the highest-leverage single page, and the backdrop for the item-3 videos.
- [ ] Kid dashboard: chore cards as game objects, progress meters, streak visuals.
- [ ] Completion celebration: extend the existing confetti system (`lib/confetti`) into a fuller reward moment (coin fly-to-wallet, sound opt-in).
- [ ] Wallet/coin animations on balance change (`CoinIcon` is already shared).
- [ ] Store/avatar: reveal-on-unlock treatment.
- [ ] Achievements + Pillars of Responsibility: badge shelf, level-up moment, title reveal (identity titles already exist in `lib/responsibility/titles.ts`).
- [ ] Replace achievement placeholder SVGs (`/achievements/placeholders/*`) with real art — currently ~40+ placeholders.
- [ ] Skeleton loaders styled to match the new direction (already a project rule — no plain "Loading …" text).
- [ ] Empty states with character/illustration instead of plain text.
- [ ] Audit for accessibility: contrast, focus states, motion sensitivity, screen-reader labels on decorative animation.
- [ ] Mirror the direction into `apps/mobile` where practical, or explicitly document the divergence per `AGENTS.md`.

### Sequencing
Direction + homepage first (unblocks item 3 filming), then kid-facing surfaces, then parent surfaces, then mobile.

### Acceptance
A documented visual direction, a refreshed marketing homepage and kid dashboard, reduced-motion support throughout, and no regression in dashboard load performance.

---

## 7. Family leveling / progressive feature unlock

**Status:** Not started · **Owner:** TBD · **Touches every surface in the app**

### The problem
The app has grown a lot of genuinely useful capability — chores, recurrence, routines, Pillars of Responsibility, identity titles, achievements, store/awards, approvals inbox, Google Tasks sync, ghost chores, kiosk mode, Family Friends, feed. A new parent sees all of it at once and bounces. The features that actually help parents raise capable kids are the *later* ones, and they never get reached.

### The idea
A **family level** that reveals capability progressively. Level 1 is basic chores + scheduling. Each level unlocks the next layer once the family has demonstrated it's ready for it.

### The core design rule (from the product owner, and it is the whole point)
**Progression is gated on demonstrated capability, never on volume or elapsed time.** There is no "complete 10 chores to reach level 5." A parent levels up the moment they do the thing the current level is teaching. A motivated parent should be able to walk from level 1 to the top of the ladder in a single sitting if they want to. The system's job is to *sequence* the introduction of features, not to *ration* them.

Corollaries that fall out of that rule:
- Unlock conditions are **actions, not counters**: "create your first recurring chore," not "create 10 chores."
- Never show a locked feature with a wait-based requirement attached. If a family can't reach it right now by doing something, it isn't a level gate — it's either always-on or it's an entitlement.
- **A manual "unlock everything / advanced mode" escape hatch is mandatory.** Some parents arrive knowing exactly what they want. Trapping them behind a tutorial ladder is worse than the overwhelm problem being solved.
- XP continues to accrue after the ladder is exhausted, but at that point it buys **prestige and cosmetics only** — never functionality. Once unlocks are done, nothing about the app is ever withheld again.

### Naming collision — resolve before writing any code
"Level" is already taken. `apps/web/src/lib/responsibility/levels.ts` derives **per-child** Responsibility levels from cumulative XP against thresholds (`DEFAULT_LEVEL_THRESHOLDS = [0, 100, 250, 500, 900]`), and `lib/responsibility/titles.ts` layers identity titles on top. That system is child-facing, XP-driven, and grind-shaped *by design* — the exact opposite of this one.

These must not be confused in the UI, the data model, or conversation. Suggested split:
- **Child** progression stays "Responsibility Level" / identity titles (existing, per-child, XP-earned).
- **Family** progression gets a distinct name — *Family Stage*, *Family Journey*, *Chapter* — reserved for parent-facing feature unlocking. Recommend avoiding the word "level" entirely for the family concept.

The rest of this section says "family level" for clarity, but the shipped name should not.

### The hard constraint: existing families must not lose features
Every currently-active family must be grandfathered in at (or near) max stage on rollout. A family that has been using routines for months cannot log in one day to find routines "locked" behind a stage they haven't formally completed.

This is the same class of bug documented at the top of `apps/web/src/lib/family/onboarding.ts` — where existing families lacking a newer tracking field got shoved back through the new-family wizard and ended up with duplicate child profiles. Repeat that mistake here and it hits every family at once.

Concretely: derive initial stage from **observed usage** (does the family have routines? awards? friends? Google Tasks linked?), take the max of that and the computed floor, and never allow a family's stage to move backward.

### Proposed ladder (a starting point — the ordering is the real product question)
| Stage | Unlocks | Advances when the family… |
| --- | --- | --- |
| 1 · Getting started | One-off chores, assign to a child, complete → approve, coins/wallet | Approves their first completed chore |
| 2 · Building rhythm | Due dates, recurrence, custom weekly schedules | Creates their first recurring chore |
| 3 · Motivation | Store, avatars/colors/confetti, Family Awards | Creates or redeems a first Family Award |
| 4 · Structure | Routines / multi-step checklists | Creates their first routine |
| 5 · Growth | Pillars of Responsibility, identity titles, achievements surfaced | Assigns chores across multiple pillars/categories |
| 6 · Oversight | Approval Inbox, insights/stats, kiosk mode | Uses the Approval Inbox once |
| 7 · Community | Family Friends, community awards, high-fives/shout-outs (item 5) | Connects a first friend family |
| 8 · Automation | Google Tasks sync, ghost chores | Links an integration |
| Post-ladder | Nothing gated; XP → prestige/cosmetics only | Ongoing (friend invites accepted, milestones) |

Deliberate choices baked into that table: nothing in stage 1 requires reading documentation; the coin economy appears before the store (earning before spending); Family Friends sits late because cross-family features carry the most safety surface (see item 5); and each advancement condition is a single action the parent can take immediately.

### XP after the ladder
Post-unlock XP is where the "earn experience for a family friend accepting an invite" idea lives, and it dovetails with item 4's referral incentives — one XP/reward pipeline, not two. Candidate awards: a friend family accepting an invite, a child hitting a Responsibility milestone, a family streak, first use of a newly shipped feature. Cosmetic payouts only (family badge/frame/title on the dashboard, avatar and theme unlocks).

### Architecture notes
- **Build one gate, not three.** Visibility is about to be decided by role (`getViewerRole`), entitlement (`beta`/`premium`/… — defined in `AGENTS.md`, **not yet implemented**), and now family stage. Three independent gates scattered across routes and components will rot fast. Introduce a single server-side resolver — "can this viewer, in this family, see this capability?" — that composes all three, and make stage the first real consumer of it. This also settles the entitlements gap listed under Known gaps.
- **Follow the `onboarding.ts` precedent**: a pure, unit-tested decision function (`lib/family-stage/`) computing stage + unlocked capabilities from family state, consumed by both an API route and server-side guards. No stage logic inline in components.
- **Extend `lib/discovery/sections.ts`, don't fork it.** It's already the single source of truth for discoverable sections with role audiences, and its header comment explicitly says new features register there rather than adding one-off badge logic. Stage gating belongs alongside `audience`. A locked section must not emit discovery counts — badging a feature as "new!" that the family can't open is the worst of both worlds.
- `lib/ui/main-navigation.ts` is a static four-item array (`dashboard`, `store`, `achievements`, `more`) and will need stage-aware filtering. Mobile needs the same treatment.
- **Enforce server-side.** Hiding nav links is UX; the API routes for a locked capability must also refuse, or the gate is decorative. Same rule `AGENTS.md` already sets for entitlements.
- Stage/XP live on the family document (`families/{familyId}`), alongside the existing privacy/consent fields — classification `FAMILY_PRIVATE`. No new collection needed unless a stage-history audit trail is wanted (audit log covers it).
- Support console: operators need to see a family's stage and override it for debugging and recovery. Audit every override.
- Emit analytics events on stage advancement — this is exactly the funnel data the analytics pipeline and Family Health Score were built for, and it's how you find out whether the ladder ordering is right.

### UX
- Locked features should be **visible but clearly future**, not invisible — the goal is "here's what's coming and how to get there," not hiding the roadmap from users. This is the main tension with the overwhelm problem; err toward a single tasteful "what's next" surface rather than lock icons scattered everywhere.
- Stage-up is a celebration moment and belongs in item 6's motion vocabulary.
- **Children should never experience the family stage as a restriction.** They see new things appear; they never see a lock they can't act on, and they're never told a parent hasn't unlocked something.
- Never block the parent's current task with a stage-up interstitial.

### Cross-cutting requirements
Localization ×3 in both locale copies (stage names, unlock descriptions, celebration copy) · web + mobile parity, including `/api/v1` · audit stage changes and overrides · `FAMILY_PRIVATE` classification · support visibility + override · analytics events · changelog entry · unit tests on the pure stage resolver, including the grandfathering path.

### Open questions
- Final name for the family concept (must not collide with Responsibility levels).
- Is the ladder linear, or can families unlock branches out of order? (Recommend linear for V1 — branching multiplies the state space and the testing burden for little early benefit.)
- Does the advanced-mode escape hatch skip to max stage, or reveal everything while stage keeps tracking in the background? (Recommend the latter: parents keep the celebration and the progress record without being gated.)
- Should stage ever be per-child rather than per-family? (Recommend no — this is a parent-facing configuration concept; child-facing progression is already served by Responsibility levels.)

### Acceptance
A new family sees a genuinely simple stage-1 app and can walk the entire ladder in one session without waiting on anything; every existing family lands at their correct stage with zero features lost; locked capabilities are refused server-side; and a parent can opt out of gating entirely.

---

## Cross-cutting checklist for every item above

Every user-facing change in this roadmap must satisfy the standing rules in `AGENTS.md`:

- [ ] Locale keys added for `fr-FR`, `en-US`, `es-US` in **both** `packages/locales/src/` and `apps/web/packages/locales/src/`
- [ ] Web + mobile parity considered; intentional exceptions documented
- [ ] `/api/v1/*` proxy added when mobile needs the endpoint
- [ ] Audit logging on important state changes (`writeAuditLogBestEffort`)
- [ ] Data classification declared for any new collection/field
- [ ] Support console visibility where practical (but **no changelog entries for operator-only tooling**)
- [ ] Changelog entry in `apps/web/src/data/change-log.json` (`image`, `date`, `type`, `subject`, `description`) with localized labels
- [ ] Tests for workflow-critical behavior; Playwright E2E for major new workflows
- [ ] `npm run typecheck` + `npm run test` clean (do not use `npm run lint` — ESLint is broken)

## Known gaps surfaced while writing this roadmap

Small, real, and not owned by any item above:

- Root `app.json` android package (`com.anonymous.choresgame`) conflicts with `apps/mobile/app.config.js` (`com.orcwood.familychores`). Fix before any release build.
- No `apps/mobile/eas.json` — hard blocker for items 1 and 2.
- `AGENTS.md` defines entitlement types (`beta`, `referral`, `premium`, …) but no entitlements module exists in `apps/web/src/lib`. Item 4 is the first thing that needs one and item 7 is the second — they should share a single capability gate rather than each growing their own.
- Achievement art is ~40+ placeholder SVGs. Item 6 should absorb this.
- `docs/openapi.todo.md` and `apps/mobile/docs/unity-integration.todo.md` are open TODO stubs not represented on this roadmap.
