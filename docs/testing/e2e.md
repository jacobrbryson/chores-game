# Playwright E2E Testing

Playwright protects a small set of business-critical Family Chores workflows. Keep this suite focused on user outcomes, not exhaustive UI coverage.

## Running Tests

```bash
npm run test:e2e
npm run test:e2e:headed
npm run test:e2e:ui
npm run test:e2e:debug
```

The config starts the web app on `http://127.0.0.1:3000` unless `PLAYWRIGHT_BASE_URL` or `PLAYWRIGHT_SKIP_WEBSERVER` is set.

## Test Users

Do not use production users. The default dedicated identities are:

```text
parent.test@family-chores.test
child.test@family-chores.test
support.test@family-chores.test
```

Seed Firestore records with:

```bash
FIREBASE_PROJECT_ID=... FIREBASE_SERVICE_ACCOUNT_KEY='...' npm run test:e2e:seed
```

Create matching Firebase Auth test users separately, then provide their current Firebase ID tokens:

```text
E2E_PARENT_UID
E2E_PARENT_FIREBASE_ID_TOKEN
E2E_CHILD_UID
E2E_CHILD_FIREBASE_ID_TOKEN
E2E_SUPPORT_UID
E2E_SUPPORT_FIREBASE_ID_TOKEN
SUPPORT_ADMIN_EMAILS=support.test@family-chores.test
SESSION_SECRET=<32+ character local secret>
```

When these tokens are missing, specs skip with a clear reason. This lets CI validate the Playwright project wiring without depending on shared secrets in every environment.

## Reports And Debugging

HTML reports are written to `playwright-report/`. Failure artifacts are written to `test-results/`.

On failure Playwright keeps:

- screenshot
- trace
- video

Open the report with:

```bash
npx playwright show-report
```

Use traces first for flaky failures because they include DOM snapshots, network calls, and console output.

## Adding Tests

Use helpers from `e2e/helpers` for login, chore setup, approvals, and console-error monitoring. Add new helpers when a workflow repeats across specs.

Prefer a few high-value workflows:

- parent creates and assigns chores
- child completes assigned chores
- parent approval and coin payout
- privacy export and child access restrictions
- support content publishing
- discovery badge behavior

Avoid brittle assertions about styling, layout internals, or implementation-only text. Assert what the user can see or the API outcome that backs the visible workflow.
