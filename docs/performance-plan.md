# Performance Plan — 500ms Budget for All Requests

**Goal:** p95 server response time < 500ms for every API route on web and mobile.

**Status:** Plan. No changes applied yet.

> **Measurement caveat:** the findings below come from reading the code, not from
> production traces. The call counts are structural (how many Firestore round
> trips a handler *must* make), not measured latencies. Phase 0 exists to replace
> every estimate here with a real number before we spend effort on Phases 2–5.

---

## Traced: "Complete a chore" on mobile (3–10s)

This one action was traced end to end. It is **~30–50 sequential network round
trips**, several of which are blocking calls to external services.

**The path:**

1. Mobile → `POST /api/v1/chores/{id}/complete`
2. Loopback HTTP hop → `PATCH /api/chores/{id}` (second handler, cookie parsed again)
3. `getPrimaryFamilyId` → `GET users/{uid}`
4. `handleComplete` ([complete.ts:70](apps/web/src/app/api/chores/[choreId]/actions/complete.ts:70)) —
   **26 sequential `await`s, zero `Promise.all`**
5. Then `syncGoogleTasksBestEffort({ force: true, minIntervalSeconds: 0 })`
   ([route.ts:318](apps/web/src/app/api/chores/[choreId]/route.ts:318)) — a *forced*
   external Google API sync, awaited before responding
6. Mobile then refetches the chore list / summary

**Of those 26 awaits, exactly one is the write the user asked for**
(`patchDocument` on the chore doc, line 231). The rest are side effects:

| Blocking work in `handleComplete` | Cost |
|---|---|
| `publishFamilyActivity` × 2 (lines 346, 376) | HTTP POST to the **WS server** |
| `trackEvent` × 3 (lines 427, 444, 453) | 3 separate admin Firestore writes |
| `emitFamilyActivityBestEffort` × 2 | 2 Firestore writes |
| `resolveAssigneeUid` × 3 (lines 296, 390, + inside payouts) | same lookup, re-fetched each time |
| `applyPayoutByAssignee` | **serial loop**: `resolveAssigneeUid` + `applyWalletDelta` per assignee |
| `awardChoreResponsibilityXpBestEffort` | **serial loop** per player |
| `listAllDocuments(chores)` (line 155) | full chore-collection scan, for routine handling |
| `writeAuditLogBestEffort`, `awardNewSkillBonuses`, `resolvePaidPlayerUids`, `userHasFamilyMembership`, `computeCompletionDerivedMaximumsBestEffort`, `trackAchievementEventBestEffort`, `recordRoutineStepCompletionBestEffort` | one or more round trips each |

### The likely 3–10 second spike: a cold WS server inside the request

`apps/ws/apphosting.yaml` also sets **`minInstances: 0`**.

`publishFamilyActivity` ([publish-family-activity.ts:19](apps/web/src/lib/ws/publish-family-activity.ts:19))
POSTs to that scale-to-zero service and **fully awaits the response** — with
**no timeout**. It is called **twice** per completion.

So every chore completion can block on a cold-starting *second* Cloud Run
container. This is a different problem from the web app's cold start (which is
fine to accept — it happens once, before the user is interacting). This one sits
in the middle of every single write action, every time the WS service has scaled
down. It also fans out: for `chore_completed` it first calls `listFamilyFriends`
and then POSTs once **per friend family**.

**Arithmetic that matches the symptom:** ~35 round trips × ~40ms (no keep-alive,
so each pays a TLS handshake) ≈ 1.5s, plus a cold WS container (1–5s), plus a
forced Google Tasks sync. That is 3–10 seconds.

---

## Why it's slow — root causes found

### A. Cold starts (accepted for the web app — but see the WS server above)

`apps/web/apphosting.yaml` sets `minInstances: 0`, and `cpu`, `memoryMiB`, and
`concurrency` are all commented out (defaults: 1 CPU / 512 MiB / 80).

For a low-traffic family app, most sessions arrive after an idle gap, so the
*first* request of nearly every session pays a full Next.js container cold start.
That is seconds, not milliseconds, and no amount of query tuning fixes it. It
also explains why mobile feels worse than web: mobile opens cold far more often
than a browser tab that is already warm.

512 MiB is also tight for a Next.js server with 198 routes — worth confirming we
aren't hitting GC pressure or OOM restarts.

### B. There is no caching layer anywhere

A grep for `unstable_cache`, `revalidateTag`, `next: { revalidate }`, LRU, or Redis
across `apps/web/src` returns **zero hits**. Every request recomputes everything
from Firestore REST. The only cache in the codebase is a client-side one
(`@/lib/family/summary-cache`) and it is used inconsistently.

### C. ~~Every Firestore call is a fresh HTTPS connection~~ — WRONG, disproved

**This claim was incorrect and is retracted.** It originally read that
`requestFirestore` uses bare `fetch()` with no keep-alive, so every Firestore
call pays a fresh TLS handshake.

Measured A/B against `firestore.googleapis.com` on Node 22 (8 sequential calls,
median steady-state):

| | median |
|---|---|
| pooled (default `fetch`) | **29ms** |
| forced new connection (`connection: close`) | **163ms** |

Node's `fetch` is undici-based and **pools connections by default**. Reuse is
already happening and already saving ~130ms per call. Adding an explicit
keep-alive `Agent` would gain nothing. Phase 1 item 4 is withdrawn.

**The real lesson:** per-call latency measured *locally* (~114ms average) is
dominated by this machine's round trip to Google, not by handshakes. A Cloud Run
instance in the same region as Firestore has a far lower RTT, so local per-call
figures overstate production cost. The `Server-Timing` instrumentation now ships
in the app — **the call counts transfer to production, the millisecond figures do
not.** Measure there before optimizing per-call latency any further.

### D. Every protected route pays a 2-round-trip auth preamble

The standard route preamble is sequential:

1. `getPrimaryFamilyId(uid, idToken)` → `GET users/{uid}`
2. `getViewerRole(familyId, uid, idToken)` → `GET families/{familyId}/members/{uid}`

That is two serial round trips before any real work starts, on ~150 routes. Worse,
`getViewerRole` ([access.ts:69](apps/web/src/lib/family/access.ts:69)) falls back to
listing **200 member documents** when the direct read 404s.

Both values are stable for the life of a session and are near-perfectly cacheable.

### E. Read endpoints do writes and external API calls on the critical path

`/api/family/summary` awaits `syncGoogleTasksForUser` **unconditionally**
([summary/route.ts:440](apps/web/src/app/api/family/summary/route.ts:440)) — external
Google API round trips on every dashboard load.

This is already fixed in `/api/chores`, which gates it behind
`if (viewerGoogleTasksLinked)` ([chores/route.ts:955](apps/web/src/app/api/chores/route.ts:955))
with a comment explaining exactly this problem. The fix was never backported —
and `viewerGoogleTasksLinked` is *already read* 18 lines above the call site in
summary. **This is a one-line change.**

Both routes then await `rolloverOverdueRoutineAssignmentsBestEffort`, which lists
all routine assignments and then loops **serially** issuing `adminGetDocument`
reads plus writes per overdue item
([assignment-service.ts:316](apps/web/src/lib/responsibility/assignment-service.ts:316)).
A GET request is performing an unbounded serial write loop.

### F. N+1 fan-out in `/api/family/summary`

For every family member, the route runs
`listAllDocuments('users/{uid}/walletLedger', cap: 1000)`
([summary/route.ts:641](apps/web/src/app/api/family/summary/route.ts:641)) — paging up
to 1000 ledger documents **per member** — solely to sum lifetime coins earned.

A 5-member family can trigger ~20 extra Firestore round trips for one derived
integer that should be a denormalized counter.

### G. Whole-collection reads filtered in JavaScript

`/api/chores` and `/api/family/summary` pull entire collections (`listAllDocuments`
on chores, `listDocuments(members, 200)`, categories) and filter/sort in JS.
Firestore `runQuery` with server-side `where` + `limit` + `orderBy` exists in the
codebase but is not used on these hot paths. We pay network transfer and JSON
parse cost for documents we immediately discard.

### H. Mobile pays a double hop on every request

All 66 `/api/v1/*` routes are thin proxies that re-issue the request over
**loopback HTTP** to the internal `/api/*` route
([_lib/response.ts:33](apps/web/src/app/api/v1/_lib/response.ts:33)).

Every mobile request therefore: runs two Next.js route handlers, parses and
verifies the session cookie twice, serializes and re-parses the JSON body twice,
and occupies **two concurrency slots** on a single-CPU container. Under any
contention this compounds badly.

### I. Duplicate client fetches of the most expensive endpoint

`/api/family/summary` — the single heaviest route — is fetched with
`cache: "no-store"` from at least six components (`family/page.tsx`,
`family-card.tsx`, `add-edit-chores-dialog.tsx`, `family-growth-card.tsx`,
`kiosk-active-client.tsx`, `kiosk-entry-client.tsx`). The same expensive payload
is recomputed several times per page load.

`apps/web/src/app/family/page.tsx` is also `"use client"`, producing an
HTML → JS → hydrate → fetch waterfall before anything renders.

---

## Should we switch to a relational database?

**Not now.** The traced write path shows the bottleneck is the *number of
sequential round trips and blocking side effects*, not the data model.

A relational DB would genuinely help with three things: the repeated
member/assignee lookups become a join, the ~15 scattered writes become one
transaction, and full-collection scans become real indexed queries. That is a
real argument — the current code does have a shape that SQL models better.

But it would not fix the parts that actually dominate:

- 26 sequential awaits stay 26 sequential awaits
- blocking on a cold WS server stays blocking
- the forced Google Tasks sync stays
- the loopback proxy hop stays
- the client refetch after mutation stays

And the same wins are available in Firestore for a fraction of the cost:
`commitWrites` (already implemented in `rest.ts`) batches all those writes into
**one** round trip, and `runQuery` gives indexed server-side filtering. The
migration cost is the other side: 198 routes, `firestore.rules`, realtime
listeners, and the mobile client — months of work, during which nothing else ships.

**Recommendation:** do Phase A below first. If routes are still over budget once
writes are batched and side effects are off the request path, revisit this with
real data — at that point the argument would be about the data model itself
rather than about latency, which is a much better position to decide from.

## Will more caching fix it?

**Not for this symptom.** Completing a chore is a *write*. A read cache does
nothing for it. Caching is worth doing (Phases 1/3/5) and will help the list and
dashboard screens, but it is not the answer to "clicking complete takes 3–10
seconds" — and building a cache layer first would burn the effort in the wrong place.

The one caching-adjacent fix that *does* apply here: after the mutation returns,
mobile refetches the heavy list/summary endpoints. Returning the updated chore
from the mutation and applying it optimistically removes that entirely.

---

## Phase A — Fix the write path (do this first)

This targets the reported symptom directly. Roughly ordered by win-per-effort.

**Items 1–4 are implemented across every chore action** — `complete`, `approve`,
`reject`, `skip`, `unskip`, `undo_complete`, `edit`, and `delete`
([actions/](apps/web/src/app/api/chores/[choreId]/actions/)).

1. ~~**Stop awaiting side effects.**~~ **Done.** Added
   `runAfterResponse()` ([after-response.ts](apps/web/src/lib/async/after-response.ts)),
   wrapping Next 15.2's `after()` with an inline fallback for callers that have no
   request scope (unit tests invoke route handlers directly). Deferred in
   `handleComplete`: both `publishFamilyActivity` calls, the audit log, the entire
   per-assignee achievements loop, and the 3 `trackEvent` writes (now also
   parallel with each other).
2. ~~**Add a timeout to every external call.**~~ **Done.** 2s
   `AbortSignal.timeout` on the WS publish, plus a per-target `try/catch` so one
   slow friend family no longer aborts the publish to the others via `Promise.all`.
3. ~~**`minInstances: 1` on `apps/ws`.**~~ **Done** in `apps/ws/apphosting.yaml`.
4. ~~**Forced Google Tasks sync off the completion path.**~~ **Done** — moved into
   `after()` rather than deleted. `force: true` is *kept*: this sync exists to
   mirror the transition back to Google, so dropping the flag would have silently
   stopped completions syncing upstream. Deferring achieves the latency goal
   without changing behaviour.
5. ~~**Batch the remaining writes into one `commitWrites`.**~~ **Done for `complete`,
   but it produced no measurable latency win** — median went 2383ms → 2788ms,
   inside the run-to-run noise band (individual runs spanned 1544–3288ms). The
   change is still worth keeping for correctness: the status change and the
   spawned recurring occurrence are now atomic, where before a failure on the
   status patch could leave an orphaned next occurrence. A field mask was also
   added to the recurrence chore scan.

   **The lesson: the writes were never the bottleneck.** Per-call instrumentation
   showed the completion path is dominated by *repeated reads*, not writes —
   `users/{uid}` fetched ~10 times and `families/*/members/{uid}` ~5 times in a
   single request, each a separate 60–300ms round trip. Items 6 and 7 target
   exactly that and should be done before any further write batching.

   Superseded batching note — the chore patch, wallet
   delta, XP award, and activity docs are one atomic batch, not 15 round trips.
6. ~~**Memoize member lookups per request.**~~ **Done — small win.** Implemented in
   [request-context.ts](apps/web/src/lib/observability/request-context.ts) and applied to
   `getPrimaryFamilyId`, `getViewerRole`, `getRequesterContext`, `resolveAssigneeUid`,
   and `userHasFamilyMembership`. It removes **3 redundant reads** from `complete`
   and 0 from `undo_complete`.

   Less than predicted, for a good reason: the repeated `users/{uid}` and
   `members/{uid}` reads seen in the raw call log were mostly inside the
   achievement and analytics blocks, and **items 1–4 already moved those off the
   request path**. The duplication was real, but deferral had already collected
   most of that win. Keep the memoization — it is correct, it protects the
   deferred work too, and it prevents the duplication from creeping back — but the
   remaining 16 calls are genuinely distinct reads, not repeats.
7. **Parallelize the independent reads** at the top of `handleComplete`
   (chore doc, assignees, requester context) with `Promise.all`.
8. **Return the updated chore from the mutation** and apply it optimistically on
   mobile, so no refetch of the heavy list endpoints is needed.
9. **Remove the loopback proxy hop** for this route (see Phase 5.2).

**Expected:** the response becomes ~3–5 round trips of genuinely required work.
This is the path to sub-500ms for the action the user actually complained about.

### What is deferred, and what deliberately is not

Deferred in every action: `writeAuditLogBestEffort`, `publishFamilyActivity`,
`trackAchievementEventBestEffort` (with the per-assignee resolution loops that
feed it), `trackEvent`, and `syncGoogleTasksBestEffort`.

**Kept on the request path on purpose:** `emitFamilyActivityBestEffort`. It writes
the notification doc backing the Family Activity Feed, which the client reads
immediately after a mutation — deferring it would make the feed intermittently
miss the action the user just took. It is one Firestore write; the round trips
worth removing were elsewhere.

Also kept: the chore `patchDocument`, wallet payouts, XP awards, and routine
progress — all either the actual mutation or values returned in the response.

### Remaining after items 1–4

- The same pattern applies to `/api/family/summary` and the other GET routes
  (Phase 2).
- **Cloud Run CPU throttling:** post-response work can be throttled unless the
  service runs with CPU always allocated. Everything deferred here is
  best-effort and swallows its own failures, so throttling delays it rather than
  breaking it — but if the audit log or analytics start arriving late in
  production, that setting is the reason.
- **Not yet measured end to end.** The latency win is inferred from removing
  known-blocking calls; Phase 0 instrumentation is what will confirm it against
  a real authenticated session.

---

## Measured results (clean dev server, real family data)

Taken after a full dev-server restart, first (compiling) pass discarded.

### Chore mutation — `PATCH /api/chores/{id}`, 5 iterations

| Action | Firestore calls | Wall (median) | Originally |
|---|---|---|---|
| `complete` | **16** | **1340ms** | 5761ms → **4.3× faster** |
| `undo_complete` | **11** | **1152ms** | 3287ms → **2.9× faster** |

### Page load — `/family`

| Pass | FCP | Last API finishes |
|---|---|---|
| Cold (dev compile) | 5872ms | **11657ms** |
| Warm #1 | 468ms | 3463ms |
| Warm #2 | 184ms | **2998ms** |

11 API requests, **zero duplicates**, zero failures.

**The "13 seconds to usable" was the cold dev compile, not the app.** A warm load
is ~3s, and the first paint is under half a second. Dev compile time does not
exist in a production build — which is another reason the remaining numbers need
to be confirmed in production rather than here.

Slowest remaining on page load: `/api/family/summary` (2547ms),
`/api/store` (1935ms) and `/api/store?brief=1` (1778ms) — all three run in
parallel, so they set the ~3s floor together.

**Read this table by the call count, not the wall clock.** Dev-mode wall times
have ranged 1544–3766ms for the identical operation across this work — far too
noisy to detect anything smaller than a 2× change. Firestore call count is
deterministic and is the metric to optimize against.

Two conclusions from it:

1. **16 sequential calls averaging ~114ms each is the whole problem.** 1825ms of
   the request is Firestore round trips, essentially all serial. Getting under
   500ms means fewer calls, parallel calls, or cheaper calls — not micro-tuning.
2. **Per-call latency is NOT the lever — and these ms figures do not transfer to
   production.** ~114ms per round trip locally is this machine's RTT to Google,
   not handshake overhead (connection pooling is already on — see root cause C).
   A Cloud Run instance co-located with Firestore has a far smaller RTT, so the
   same 16 calls may cost dramatically less in production. **The call count is
   what transfers; the milliseconds are local artifacts.**

The honest next step is therefore to deploy the `Server-Timing` instrumentation
and read real production numbers, rather than optimize further against a dev
server whose per-call cost is dominated by home-internet latency.

## Phase 0 — Measure first (do this before anything else)

Nothing below should be tuned blind. This phase is small and makes every later
fix verifiable.

1. **Instrument the Firestore client.** Wrap `requestFirestore` with an
   `AsyncLocalStorage` per-request context that counts calls and accumulates ms.
   ~30 lines in one file, covers all 198 routes at once.
2. **Emit `Server-Timing`** on every API response: total handler ms, Firestore
   call count, Firestore total ms, external-API ms. Makes the waterfall visible
   in browser devtools with no extra tooling.
3. **Make route timing universal, not opt-in.** Today `operationMetrics` is
   recorded per-route by hand. Move it into a shared wrapper.
4. **Lower `SLOW_OPERATION_THRESHOLD_MS`** from `1000` to `500`
   ([metrics.ts:21](apps/web/src/lib/observability/metrics.ts:21)) so the existing
   Operations dashboard reports against the actual target.
5. **Produce a baseline table:** route → p50 / p95 / Firestore call count, sorted
   by p95 × traffic. That table, not this document, decides the work order after
   Phase 1.

**Exit criteria:** a ranked list of routes over budget, with call counts.

---

## Phase 1 — Infrastructure (highest leverage, lowest code risk)

Do this immediately and in parallel with Phase 0 — it needs no application changes.

1. **`minInstances: 1`** (consider 2) in `apphosting.yaml`. This is the single
   highest-impact change available and likely resolves most of the "unusable on
   mobile" complaint on its own. It has a real, ongoing cost — an always-warm
   instance is billed continuously — so it's a deliberate trade, not a free win.
2. **Set resources explicitly:** `cpu: 2`, `memoryMiB: 1024`, `concurrency: 80`.
   Extra CPU during cold start also shortens the start itself.
3. **Confirm Cloud Run region matches the Firestore region.** A cross-region
   mismatch adds tens of ms to *every one* of the many round trips per request,
   and it is invisible in code.
4. ~~**Enable HTTP keep-alive** for Firestore calls.~~ **WITHDRAWN — not a real
   problem.** Measured: Node's undici-based `fetch` already pools connections
   (29ms pooled vs 163ms forced-new). See root cause C above. No code change made.

**Expected:** large, broad reduction across all routes. Re-baseline after this
before doing per-route work — some routes may already be under budget.

---

## Phase 2 — Get side effects off the read path

**Rule to adopt: a GET handler performs no writes and no external API calls.**

1. Gate `syncGoogleTasksForUser` in `/api/family/summary` behind
   `viewerGoogleTasksLinked` — backport of the existing `/api/chores` fix. One line.
2. Move Google Tasks sync **entirely** off request paths into a scheduled job
   (or a fire-and-forget task that never blocks the response). Even for linked
   users, a dashboard load should not wait on Google.
3. Move `rolloverOverdueRoutineAssignmentsBestEffort` to a scheduled daily job.
   If it must stay request-triggered, make it fire-and-forget and batch its
   writes via `commitWrites` instead of the serial per-item loop.

**Expected:** removes unbounded external latency and serial write loops from the
two most-loaded endpoints.

---

## Phase 3 — Eliminate the auth preamble round trips

Targets ~150 routes at once.

1. **Carry `familyId` in the session cookie.** The cookie already carries `uid`,
   `role`, `email`, and Firebase tokens. Adding `familyId` (written at sign-in
   and rotated on family change) makes `getPrimaryFamilyId` a **zero-read**
   operation, with the current Firestore lookup kept as the fallback path.
2. **Short-TTL in-process cache for `getViewerRole`** keyed by `familyId:uid`
   (30–60s TTL). Role changes are rare and already rotate the session.
3. **Remove the 200-document member-list fallback** from the hot path — make it a
   recovery path only, entered on an explicit miss rather than on every 404.

**Caution:** role is a security boundary. Cache the *lookup*, keep the *check*
server-side, and make sure any role change invalidates both cookie and cache.
Under Switch To… / Kiosk, `session.uid` is not the Firebase token uid, so cache
keys must use the same identity resolution the reads use — otherwise a kiosk
session can read a parent's cached role.

**Expected:** −2 serial round trips on nearly every protected request.

---

## Phase 4 — Fix the fan-out routes

Order by the Phase 0 table. Expected top entries:

1. **`/api/family/summary` wallet ledger N+1** — denormalize
   `lifetimeCoinsEarned` onto the member document, maintained by the
   `walletLedger` write path. Deletes the per-member 1000-doc scan entirely.
2. **Replace whole-collection reads with `runQuery`** — push `where` / `orderBy` /
   `limit` server-side for chores and members instead of filtering in JS.
3. **Audit every `await` inside a loop** in `app/api/` and convert to
   `Promise.all` or a batched `commitWrites`.
4. **Split `/api/family/summary`** (1102 lines returning one mega-payload) into a
   small shell response the page needs to paint, plus deferred panel endpoints.

---

## Phase 5 — Client and mobile

1. ~~**Collapse the duplicate fetches**~~ **Done for the page-load duplicates.**
   Added [deduped-fetch.ts](apps/web/src/lib/api/deduped-fetch.ts): concurrent identical
   GETs share one round trip. Measured on a real `/family` load, duplicates went
   from three pairs to **zero**, and total API requests from **14 → 11**:

   | URL | before | after |
   |---|---|---|
   | `/api/store?brief=1` | 3 | 1 |
   | `/api/discovery/summary?sections=chores,store,achievements` | 2 | 1 |
   | `/api/discovery/summary?sections=changelog,requested_changes` | 2 | 1 |

   Participants are served from a buffered **response snapshot**, not
   `response.clone()`. Cloning tees the body stream, and a caller that checks
   `response.ok` and returns without reading (party-confetti-overlay does this
   when cancelled) leaves one branch unread and stalls the readers that do
   consume it. Verified, not theorised: the clone-based version **times out** on
   the 50KB regression test in `deduped-fetch.test.ts`.

   Deliberately **in-flight only** — no completed-response cache. A caller that
   starts while an identical request is open would have received that same
   response anyway, so nothing becomes staler than a plain `fetch` already was.
   Non-GET requests and any request carrying an `AbortSignal` are never shared
   (one participant aborting must not cancel another's request). Longer-lived
   caching belongs in a typed data cache like `lib/family/summary-cache.ts`.

   Note `/api/family/summary` was *not* among the duplicates on this page — the
   six call sites are on different surfaces and did not fire together here.
2. **Remove the mobile double hop.** Extract each route's body into a shared
   `lib/` handler that both `/api/*` and `/api/v1/*` call **in-process**. Kills a
   full HTTP round trip, a duplicate cookie parse, and a duplicate JSON
   round-trip on every mobile request — and halves mobile's concurrency
   footprint. This is the largest mechanical change in the plan (66 routes);
   stage it hot-routes-first.
3. **Stale-while-revalidate on mobile** so screens paint instantly from cached
   data and refresh behind the scenes. Perceived latency is what "unusable"
   actually refers to.
4. **Make `family/page.tsx` a server component** for its initial payload to
   remove the hydrate-then-fetch waterfall.

---

## Phase 6 — Keep it fast

1. Fail CI when a route's measured p95 exceeds 500ms.
2. Lint/review rule: no `await` inside a loop in `app/api/`; no writes in a GET.
3. Add the Firestore-call-count assertion to route tests so an N+1 regression
   fails the test rather than production.

---

## Routes that cannot meet 500ms

Being honest about the target: a few operations are bounded by third parties and
should be explicitly exempted and made asynchronous rather than silently missing
the budget.

| Route | Why | Approach |
|---|---|---|
| `/api/auth/google/gsi`, `/api/auth/apple` | Google/Apple token verification + Firebase IdP exchange | Exempt; one-time per session |
| `/api/family/privacy/export` | Full-family data export | Return `202` + job id, deliver async |
| Athena / AI ghost-chore routes | External model inference | Already async; keep off request paths |
| Any bulk import/copy | Unbounded write volume | `202` + background job |

Everything else should hold the 500ms p95 budget.

---

## Suggested order

1. **Phase A** (write path) — targets the actual reported symptom. Start here.
2. **Phase 0** (measurement) — in parallel; required to direct everything after.
3. **Phase 1** (infra: keep-alive, WS `minInstances`, region check) — the web app's
   own `minInstances: 0` is accepted and deliberately left alone.
4. **Phase 2** (side effects off read path) — same fix as Phase A, applied to GETs.
5. **Phase 3** (auth preamble) — broad win across ~150 routes.
6. **Phase 4 / 5** — driven by the Phase 0 table, highest p95 × traffic first.
7. **Phase 6** — once under budget.

Revisit the relational-database question only after Phase A + Phase 4, with
measurements in hand.
