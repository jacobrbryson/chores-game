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
| 1 | Android app on Google Play | In progress — internal testing live | Release ops | Yes |
| 2 | iOS app on the App Store | Not started | Release ops | Yes |
| 3 | YouTube product demo videos | Not started | Marketing | No |
| 4 | Family invite / referral build-out | Partial | Product | No |
| 5 | Friend high-fives, shout-outs, cross-family prizes | Not started | Product | No |
| 6 | Website refresh — fun, animated, game-like | Not started | Product/design | No |
| 7 | Family leveling / progressive feature unlock | Not started | Product (cross-cutting) | No |
| 8 | Weekly email cron + "Week in Review" celebration | Partial | Product + ops | No |
| 9 | Android build size evaluation | Not started | Release ops | No |

Items 1 and 2 are sequential-ish gating work with external review latency; 3–8 can proceed in parallel.
Suggested order: **1 → 2** (start immediately, long lead times) with **6** running alongside, then **7 → 4 → 5**, and **3** once the refreshed UI from 6 exists to film. **Item 8's cron half is small and nearly done — it can ship on its own at any point.**

**Item 7 is a cross-cutting dependency and should be designed before 4, 5, and the kid-facing half of 6.** It decides which surfaces are visible to which families, so item 4's referral incentives, item 5's cross-family features, and item 6's celebration moments all want to know about it. Its ladder design (which feature unlocks when) is also the cheapest thing on this roadmap to get wrong and the most expensive to change later, because unlock order becomes a promise to existing families.

---

## 1. Android app on Google Play

**Status:** **Internal (private) testing live — install from Google Play confirmed working 2026-08-12** · **Owner:** TBD

The Expo app (`apps/mobile`, Expo 54 / RN 0.81) builds through EAS and is distributing on Play's internal testing track. A verified install from Play also confirms the pieces that only fail in a store-delivered build: Play App Signing, the upload keystore, and the release SHA-1 registration behind Google Sign-In. What remains is the policy/listing work required to widen the audience.

### Current state
- `apps/mobile/app.config.js` sets `android.package = com.orcwood.familychores`, icons, adaptive icon, and splash.
- `apps/mobile/eas.json` now defines development/preview APK profiles, a production AAB profile with remote version-code auto-incrementing, and a draft internal-track submit profile using EAS-managed credentials.
- No Play Store listing assets yet (feature graphic, phone/tablet screenshots, short/full description).
- EAS-managed upload credentials are generated and the app is enrolled in Play App Signing.
- The release SHA-1 is registered on the Android OAuth client — confirmed by Google Sign-In working in the Play-delivered internal build. `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` and server-side `GOOGLE_ANDROID_CLIENT_ID` are wired correctly for release.

### Package-id resolution
The stale root `app.json` that declared `com.anonymous.choresgame` has been removed. All supported scripts and EAS profiles run from `apps/mobile`, whose Expo config and native Gradle project both use `com.orcwood.familychores`. The duplicate root `android/` tree is a legacy generated project with no package-script entry point; it is not the mobile release project and must not be built or submitted.

### Work
- [x] Remove the stale root `app.json`; all supported mobile builds run from `apps/mobile` with package id `com.orcwood.familychores`. The unused legacy root `android/` tree must not be built.
- [x] Create Google Play Console developer account; complete identity verification.
- [x] Add `apps/mobile/eas.json` with `development` / `preview` / `production` build profiles and a `submit` profile.
- [x] Generate the EAS-managed Android upload keystore and enroll the first uploaded AAB in Play App Signing.
- [x] Register the release SHA-1/SHA-256 with the Android OAuth client so Google Sign-In works in the production build.
- [x] Produce an internal-testing AAB and confirm it installs from Play.
- [ ] Run the full functional smoke pass on the **Play-installed** build (not a dev client): Google Sign-In, family summary, chore complete/approve, wallet, realtime feed, deep links (`familychores://`), and locale switching (`fr-FR`/`en-US`/`es-US`). The smoke-test checklist is in `docs/release/android-play-store.md`.
- [ ] Set a `version` (versionName) in `apps/mobile/app.config.js` — it is currently unset, so builds report `1.0.0` while EAS auto-increments only the versionCode. Worth fixing before the first public-facing release so version reporting is meaningful.
- [ ] Complete the Play Data Safety form. Must match the actual data model — this app handles `CHILD_SENSITIVE` data (child names, avatars, activity history).
- [ ] Complete Play's **Families / Designed for Families** policy questionnaire and target-audience declaration. A kids-inclusive audience triggers extra requirements: no ads SDKs, restricted data collection, verified content rating.
- [ ] Content rating questionnaire (IARC).
- [ ] Store listing: title, short description, full description, feature graphic (1024×500), phone + 7"/10" tablet screenshots, app icon (512×512).
- [ ] Point the listing's privacy policy URL at the live `/privacy-policy` route.
- [ ] Internal testing track → closed testing → production rollout.

The operator handoff, commands, release audit, policy worksheet, smoke tests, and asset inventory are in `docs/release/android-play-store.md`.

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
- [ ] **Sign in with Apple — scoped in `docs/release/sign-in-with-apple.md` (2026-08-12).** Decision: implement it. The provider swap is small (`signInWithIdp` with `providerId=apple.com`; everything downstream is provider-agnostic), but Apple's Hide My Email breaks the email-keyed family-join path and silently drops invited children into brand-new empty families. Fixing the join path to use invite tokens instead of email equality is the real work — and it overlaps directly with item 4.
      Guideline 4.8 requires an equivalent privacy-preserving login option when third-party sign-in is the only option, and adding email/password instead does not satisfy it (it doesn't let the user keep their email private). Google sign-in is unchanged; this adds a second door. **Still the single largest engineering risk in items 1–2.**
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

### Decided (2026-08-10)
- **Referral rewards are two-sided**, and pay out only on acceptance. Both the inviting family and the accepting family receive the achievement + cosmetic unlock.
- Rationale: a one-sided reward turns the invite into a solicitation — the sender visibly gains something the recipient doesn't, which is exactly the shape of spam and reads that way to the person receiving it. A two-sided reward makes the invite a gift, which both converts better and keeps the mechanic honest on a product used by children. Paying only on acceptance (never on send) keeps the incentive pointed at real connections.

### Open questions
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
   - **DECIDED (2026-08-10): V1 ships templated shout-outs only** — the parent picks from a localized phrase list ("was really kind to my kid today", "showed great sportsmanship") and selects the child it's about. No free-text field crosses a family boundary in V1.
   - Rationale: the templates deliver essentially the whole emotional payoff — a named child gets specific recognition from another family's parent — while removing the need for a moderation queue, a report/block flow, and human review of adult-written text about other people's children before V1 can ship. It also makes the localization tractable: a fixed phrase list translates cleanly into `fr-FR`/`es-US`, whereas free text never localizes at all. Revisit free text only once there's a moderation surface to catch it.
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
- [ ] Completion celebration: extend the existing confetti system (`lib/confetti`) into a fuller reward moment (coin fly-to-wallet, sound opt-in). This engine has three consumers — chore completion, item 7's stage-up moments, and item 8's Week in Review fireworks — so build it once, here.
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

### The ladder — DECIDED for V1 (2026-08-10)

**Every advancement condition must be completable by the parent alone, right now, with no dependency on a child, another family, or any other person.**

This is a corollary of the no-waiting rule that the first draft of this ladder violated three times: "approve your first completed chore" waits on a child to do a chore, "use the Approval Inbox once" waits on a submission existing, and "connect a first friend family" waits on another family to accept an invitation. Each would have stalled a motivated parent behind someone else's behavior — precisely the failure the rule exists to prevent. Advancement now triggers on the parent-side action; the child-side event is what earns XP, not what unlocks capability.

| Stage | Unlocks | Advances when the parent… |
| --- | --- | --- |
| 1 · Getting started | One-off chores, assign to a child, complete → approve, coins/wallet | Creates and assigns their first chore |
| 2 · Building rhythm | Due dates, recurrence, custom weekly schedules | Creates their first recurring chore |
| 3 · Motivation | Store, avatars/colors/confetti, Family Awards | Creates their first Family Award |
| 4 · Structure | Routines / multi-step checklists | Creates their first routine |
| 5 · Growth | Pillars of Responsibility, identity titles, achievements surfaced | Assigns a chore to a responsibility pillar |
| 6 · Oversight | Approval Inbox, insights/stats, kiosk mode | Opens the Approval Inbox |
| 7 · Community | Family Friends, community awards, high-fives/shout-outs (item 5) | Sends a friend-family invitation |
| 8 · Automation | Google Tasks sync, ghost chores | Links an integration |
| Post-ladder | Nothing gated; XP → prestige/cosmetics only | Ongoing (friend invites accepted, milestones) |

Deliberate choices baked into that table: nothing in stage 1 requires reading documentation; the coin economy appears before the store (earning before spending); structure (routines) comes after motivation, because a parent who has seen kids respond to rewards is ready to invest in multi-step routines and one who hasn't is not; Family Friends sits late because cross-family features carry the most safety surface (see item 5); and every condition is one action, on one screen, available immediately.

Treat the *ordering* as settled for V1 and the *unlock contents* as tunable — moving a single feature between stages is cheap, reshuffling the sequence after families have walked it is not.

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

## 8. Weekly email cron + "Week in Review" celebration

**Status:** Partial · **Owner:** TBD

Splits cleanly into two halves with very different sizes: **(A)** schedule the existing weekly email — small, nearly done; **(B)** build the Week in Review celebration page — a real feature.

### Current state (more is built than it looks)
- `POST /api/internal/newsletters/weekly/send` — secret-authed (`NEWSLETTER_INTERNAL_SECRET`, Bearer or `x-internal-secret`), calls `sendWeeklyFamilyHighlightsForAllFamilies()`.
- `NEWSLETTER_INTERNAL_SECRET` is already declared in `apps/web/apphosting.yaml` as a runtime secret.
- Idempotent per recipient/week via deterministic ids (`weekly_{weekStart}_{recipientUid}`); outcomes recorded at `families/{familyId}/newsletterSends/{sendId}` as sent/skipped/failed.
- "Only active users" already works, via skip reasons `opt_out`, `no_activity`, `invalid_email`, `duplicate_sent`, `missing_support_email`, plus opt-in preferences (`/api/newsletter/preferences`).
- Metrics computed per family by `computeWeeklyFamilyHighlightMetrics`: chores completed, coins earned, rewards redeemed, family awards claimed, achievements unlocked, pending approvals, most-active helper (with avatar + color), and recent highlights.
- Localized send per recipient (`recipientLocale`), SES provider, `weekly-family-highlights.ts` email template.
- Support console already has preview, test-send, send-family, and summary routes.

**The only thing missing from part A is the scheduler itself.** Nothing currently calls that endpoint on a timer.

### A. Cron the weekly send

- [ ] Create a Cloud Scheduler job hitting `POST /api/internal/newsletters/weekly/send` with the secret header, on a fixed weekly cadence (recommend Sunday evening or Monday morning in the primary audience's timezone — a "week in review" lands best right after the week closes).
- [ ] Prefer OIDC/service-account auth on the Cloud Run backend over a shared bearer secret if the App Hosting setup allows it; keep the secret check as defense in depth.
- [ ] Add run observability: structured start/finish logs, per-run counts (sent/skipped/failed by reason), and an alert when a run fails or sends zero for an unexpected reason. Surface the last run in the support console next to the existing summary.
- [ ] Document the schedule and the manual re-run procedure.

#### Two correctness issues to handle before turning the cron on

1. **The idempotency key depends on a rolling window.** `getPreviousWeeklyWindow()` returns a rolling 7-day window ending *today* (UTC), so `weekStart` changes every day — and `weekStart` is part of the dedupe id. That means the deterministic id protects against *same-day* retries only. If the job ever runs on two different UTC days (a retry after midnight, a manual re-run the next day, a schedule change), every recipient gets a second email. Fix by keying the send on a **fixed week identifier** (e.g. ISO `YYYY-Www`) rather than a rolling start date. This becomes doubly important for part B, below.
2. **`sendWeeklyFamilyHighlightsForAllFamilies` reads `adminListDocuments("families", 500)` and loops families sequentially.** That silently caps the send at 500 families and puts the whole run in one HTTP request against Cloud Run's request timeout. Fine today, a quiet failure later — and "quiet" is the problem: families past the cap simply never get email and nothing reports it. Move to a paged cursor with batched concurrency, and either make the endpoint resumable or fan out per-family work. At minimum, log loudly when the family count hits the page limit.

### B. "Week in Review" — the celebration

A grand, shareable weekly recap: **every family member and what they achieved this week**, with fireworks, music, and celebration. Linked from the email, and available in the app all week long.

#### Data work
- Current metrics are family-aggregate plus a single most-active helper. Week in Review needs a **per-member breakdown** — chores completed, coins earned, achievements unlocked, routines finished, streaks, responsibility/pillar progress, and a personal standout moment per member. Extend `WeeklyFamilyHighlightMetrics` with a `members[]` array rather than bolting on more `mostActiveHelper*` scalar fields.
- **Snapshot the week at generation time** into an immutable record (`families/{familyId}/weekInReview/{YYYY-Www}`), and render the page from that snapshot. Three reasons: the email and the page must show identical numbers days apart; a recomputed rolling window would change the "week" every time it's opened; and snapshots let families browse past weeks later.
- This makes the fixed-week-identifier fix from part A a hard prerequisite, not a nicety. A page that is "available to see all week" cannot be backed by a window that slides daily.
- Classification: `CHILD_SENSITIVE` (per-child activity history). `FAMILY_PRIVATE` for family aggregates.

#### Access and privacy
- The email link lands on a page full of children's names, avatars, and activity. **It must not be readable from the URL alone.** Require an authenticated session and family membership; if the link should survive a logged-out click, use a short-lived signed token that authenticates *into* the app rather than one that renders child data directly — the Family Friends invitation flow already establishes the expiring single-use token pattern to copy.
- No public/shareable-outside-the-family variant in V1. If sharing is wanted later, it needs a scrubbed projection under the public-content rules (no child names, no family identifiers) and parental consent — treat that as its own item.

#### Experience
- Entry points: the email CTA, an in-app banner or nav entry available for the whole week, and a discovery badge when a new week is ready. Register it in `lib/discovery/sections.ts` rather than adding one-off badge logic (that file is the single source of truth by convention).
- Per-member cards with avatar, member color (`dashboardPrimaryColor` is already on the member doc and already used by the completion chart), their week's numbers, and their standout moment.
- Fireworks/confetti built on the existing `lib/confetti` system, extended — not a second celebration engine. This is the same celebration vocabulary item 6 defines and item 7's stage-up moments need; build it once.
- **Music must be opt-in and never autoplay.** Browsers block autoplaying audio anyway, so a muted-by-default state with an obvious play control is both the compliant and the correct choice — a page that blasts music in a quiet room is a page people stop opening. Persist the preference.
- Honor `prefers-reduced-motion` with a genuine static fallback (project rule, and this page is the single most motion-heavy surface in the app).
- Handle the empty/low-activity week gracefully. A family that had a rough week should get encouragement, not a scoreboard of zeros — and **never a per-member ranking that makes one child the visible loser.** Celebrate each member against their own week.
- Performance budget: this page will be opened on phones from an email client. Fireworks must not make it unusable on a low-end Android.

### Cross-cutting requirements
Localization ×3 in both locale copies (email subject/body already localize per recipient; all new page copy needs the same) · web + mobile parity via `/api/v1` · audit not required for a read-only recap, but cron runs and support-triggered sends should stay observable · `CHILD_SENSITIVE` classification declared · support console visibility for cron runs and per-family snapshots · changelog entry · tests for the per-member aggregation and the fixed-week keying.

### Open questions
- Week boundary: ISO week (Mon–Sun) or Sun–Sat, and computed in UTC or the family's timezone? (Recommend the family's local week — a recap whose boundaries don't match how the family experienced the week feels wrong, and the codebase already passes `tzOffsetMinutes` for completion stats.)
- Does the recap notify children in-app, or is it parent-opened and shared aloud? (Recommend parent-opened for V1 — it's designed as a family moment.)
- Retention: how many past weeks stay browsable?

### Acceptance
The weekly email sends automatically on a schedule with no duplicate sends across retries, per-run outcomes are visible in the support console, and every recipient's link opens an authenticated Week in Review showing each family member's week — celebratory, localized, reduced-motion-safe, silent until asked, and stable for the entire week.

---

## 9. Android build size evaluation

**Status:** Not started · **Owner:** TBD · **Raised:** 2026-08-12 (observed 326MB build)

### Now that internal testing is live, measure before optimizing
The production profile builds an **app bundle**, and the app is installing from Play. That means Play is already doing per-ABI, per-density delivery, and the **Play Console now reports the real download and install size per device** — which is the only number that matters to users. Read that first: it may show there is nothing to fix, in which case this item closes without a code change. Optimizing against a locally-measured artifact size would be optimizing the wrong number.

### What the repo currently says
- `apps/mobile/android/gradle.properties` sets `reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64` — **all four ABIs, including the emulator-only x86 and x86_64.** Because production ships an AAB, these inflate the uploaded bundle but *not* the per-device download. Dropping x86/x86_64 from production is still worth doing (smaller uploads, faster builds), but it is no longer the prime suspect for a user-visible size problem.
- `android.enableMinifyInReleaseBuilds` defaults to **false** and `android.enableShrinkResourcesInReleaseBuilds` defaults to **false** (`apps/mobile/android/app/build.gradle:69,116`). R8 minification and resource shrinking are both **off** in release builds. This is the most likely *real* win and it does affect delivered size.
- The local debug artifact measures **60MB** (`android/app/build/outputs/apk/debug/app-debug.apk`), so 326MB is not what this build path produces locally — the number is coming from somewhere else (a universal APK, an on-device install size, or a dev-client build).
- `apps/mobile/assets` totals 560KB. Assets are not the problem.

### Work
- [ ] Establish which number 326MB actually is — AAB file size, universal APK, Play-reported download size, or on-device install size. These differ by several multiples and only the Play download size matters to users.
- [ ] Drop `x86,x86_64` from `reactNativeArchitectures` for production builds (keep them for emulator/dev profiles).
- [ ] Turn on `android.enableMinifyInReleaseBuilds` and `android.enableShrinkResourcesInReleaseBuilds`, then re-test thoroughly — R8 can break reflection-based native modules, so this needs a full smoke pass, not just a successful build.
- [ ] Confirm the production build ships an **AAB**, not a universal APK, so Play does per-device delivery.
- [ ] Inspect the artifact contents (Android Studio's APK Analyzer or `bundletool`) to see what actually dominates — native libs, Hermes bytecode, or resources.
- [ ] Record the before/after download size in `docs/release/android-play-store.md`.

### Resolved: the debug-signing concern
`apps/mobile/android/app/build.gradle` configures the **release** build type with `signingConfig signingConfigs.debug`. That is Expo's prebuild default, and it is moot in practice: every `eas.json` profile sets `credentialsSource: "remote"`, and a successful Play install proves the uploaded bundle was signed with real EAS-managed credentials. It would only bite a *locally* produced release build, which is not the shipping path. Left as-is.

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

- The unused root `android/` project is legacy-only and must not be built — supported builds run from `apps/mobile` with `com.orcwood.familychores`. Worth deleting outright so no future build or agent picks it up by mistake.
- `AGENTS.md` defines entitlement types (`beta`, `referral`, `premium`, …) but no entitlements module exists in `apps/web/src/lib`. Item 4 is the first thing that needs one and item 7 is the second — they should share a single capability gate rather than each growing their own.
- Achievement art is ~40+ placeholder SVGs. Item 6 should absorb this.
- `docs/openapi.todo.md` and `apps/mobile/docs/unity-integration.todo.md` are open TODO stubs not represented on this roadmap.
