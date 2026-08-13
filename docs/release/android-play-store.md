# Android Google Play release handoff

This handoff covers the account-bound work that cannot be completed in the repository. Run all EAS commands from `apps/mobile`. The canonical Android application id is `com.orcwood.familychores`; do not build the unused legacy `android/` directory at the repository root.

## Repository release baseline

- Expo app: `apps/mobile` (Expo 54 / React Native 0.81).
- User-facing version: `0.1.0`, derived from `apps/mobile/package.json` and matched by the committed native Gradle project.
- Native starting `versionCode`: `1`. EAS uses the remote version source and production `autoIncrement`, so each production build receives a unique Play version code. Before the first build, use `eas build:version:set` only if Play already has a higher version code.
- Development: installable development-client APK.
- Preview: installable release-like APK.
- Production: signed AAB for Google Play.
- Submission: production profile uploads the latest AAB to the internal track as a draft; a human completes and rolls out the release in Play Console.
- Signing: `credentialsSource: remote` lets EAS generate and retain the upload keystore. Google Play should generate and retain the separate app-signing key through Play App Signing.
- Release manifest: internet and vibration remain; legacy external-storage and overlay permissions are blocked. The debug manifest may still request overlay access for Expo developer tooling.

Release-asset audit:

- General icon and splash source exist at `apps/mobile/assets/icon-512.png` (512×512), with splash background `#ebf4fb`.
- Adaptive icon is configured, but it reuses the general icon. Its art reaches the canvas edges and needs a dedicated safe-zone-checked foreground before final submission so Android masks do not clip it.
- Splash is configured and generated in the native project, but there is no separate splash artwork. Verify it on representative Android versions and replace it if the result is not acceptable.
- No camera, microphone, location, contacts, notification, or media-library permission is required by the current mobile code.

## One-time account and app setup

1. Create the appropriate [Google Play Console developer account](https://support.google.com/googleplay/android-developer/answer/6112435) and pay the registration fee. Complete the developer identity, contact, and payment-profile verification requested for that account type; wait for approval before planning the launch date.
2. In Play Console, choose **Home → Create app**. Set the default language, app name, app (not game), free/paid status, support email, policy/export declarations, and accept Play App Signing. The package id is fixed by the first AAB as `com.orcwood.familychores` and cannot later be changed for that listing.
3. Sign in to the Expo account that will own the build project: `eas login`. From `apps/mobile`, run `eas init` if this repository has not yet been linked to an EAS project. Commit the generated project id in app config only after confirming the correct Expo organization/project.
4. Create the EAS environments named `development`, `preview`, and `production`. At minimum, set:
   - `EXPO_PUBLIC_API_BASE_URL` to the deployed HTTPS web origin ending in `/api/v1`.
   - `EXPO_PUBLIC_WS_URL` to the deployed secure realtime endpoint (`wss://` or its HTTPS Socket.IO origin).
   - `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` to the web/server OAuth client used to request the ID token.
   - `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` to the Android OAuth client for `com.orcwood.familychores` and the applicable signing certificate.
   Keep `GOOGLE_ANDROID_CLIENT_ID` in the deployed web/server environment so `/api/auth/google/mobile` accepts the configured Android audience; also retain the web client id in the server's allowed audience configuration because the native library requests its ID token with `webClientId`.
5. Run `eas credentials --platform android`, choose the production profile, and let EAS generate a new Android keystore. Download an encrypted/offline backup through the same credentials workflow and store it in a password manager or secure vault; never commit the keystore, `credentials.json`, or passwords.
6. Build the production AAB. In **Test and release → Internal testing**, create a release and upload the AAB (or use EAS Submit after completing its service-account setup). On the first upload, keep Google's recommended Play App Signing option so Google generates the app-signing key and treats the EAS key as the upload key. Review **Test and release → App integrity** and retain both certificates' fingerprints.
7. If using EAS Submit, create a Google Cloud service account, grant it the minimum Play Console release permission for this app, create its JSON key, and upload that key to EAS under the Android application's service credentials. Do not commit the JSON. With the app record and service credential in place, EAS Submit can create the first internal-track release; leave it as a draft for review.

Official references: [create an app](https://support.google.com/googleplay/android-developer/answer/9859152), [Play App Signing](https://support.google.com/googleplay/android-developer/answer/9842756), [EAS Android submission](https://docs.expo.dev/submit/android/), and [EAS app credentials](https://docs.expo.dev/app-signing/app-credentials/).

## Signing fingerprints and Google Sign-In

There are two signing certificates. The EAS upload certificate signs the AAB sent to Play; the Google Play app-signing certificate signs the APK installed from the store. A store build can therefore fail Google Sign-In even when a directly installed EAS APK succeeds.

1. Run `eas credentials --platform android`, select production, then inspect the Android keystore. Record the displayed SHA-1 and SHA-256. If fingerprints are not displayed, download the credentials/keystore through that menu and run:

   ```powershell
   keytool -list -v -keystore .\path\to\release.keystore -alias YOUR_KEY_ALIAS
   ```

2. In Google Cloud Console, open **APIs & Services → Credentials**. Create or update an **Android** OAuth client with package name `com.orcwood.familychores` and the EAS certificate SHA-1. Put that client id in `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` for preview/direct-install builds and in the server's `GOOGLE_ANDROID_CLIENT_ID` allowlist as required by the deployed auth configuration.
3. After the first AAB is uploaded, open Play Console **Test and release → App integrity → App signing**. Copy the **App signing key certificate** SHA-1 and SHA-256 (not only the upload certificate values).
4. Create a second Android OAuth client for the same package with the Play app-signing SHA-1, or otherwise add the certificate through the relevant Google/Firebase configuration. Use the resulting production Android client id in the production EAS environment and server allowlist. Register SHA-256 too wherever Firebase, App Links, or another Google API requests it.
5. Rebuild after changing any `EXPO_PUBLIC_*` value; those values are embedded at build time. Install from the Play internal-testing opt-in URL and test sign-in there. A sideloaded APK does not prove the Play-signed APK is configured correctly.

## Build and submit commands

From `apps/mobile`:

```powershell
# Development-client APK
eas build --platform android --profile development
# or: npm run build:android:development

# Release-like installable APK for device testing
eas build --platform android --profile preview
# or: npm run build:android:preview

# Play Store AAB; remotely increments versionCode
eas build --platform android --profile production
# or: npm run build:android:production

# Upload the latest production AAB to internal testing as a draft
eas submit --platform android --profile production --latest
# or: npm run submit:android:production
```

To select a specific build instead of the latest, omit `--latest` and choose it interactively. To build and submit after the service account is configured, use `eas build --platform android --profile production --auto-submit`. Complete and roll out the draft in Play Console.

## Play Console completion order

1. Finish developer account and identity verification.
2. Create the app record and confirm the fixed package id from the AAB.
3. Complete **Store presence → Main store listing**, contact details, countries/regions, and pricing. A free app cannot later be changed to paid; monetization can still be added separately if policy-compliant.
4. Complete every **Policy and programs → App content** declaration: privacy policy, app access instructions/test account, ads, Data Safety, target audience/content, content rating, and any other questionnaire Play exposes for the selected distribution regions/features.
5. Upload the first AAB to internal testing, enroll in Play App Signing, register both signing certificates for Google Sign-In, add internal testers, publish the internal release, and run the store-build smoke tests below.
6. Fix all pre-launch report, policy, sign-in, crash, and accessibility issues. Promote a known-good build to closed testing and recruit representative parent/child-family testers.
7. If this is a personal developer account created after November 13, 2023, keep at least 12 testers opted in to the closed test continuously for at least 14 days, then answer the production-access questions and apply from the Dashboard. Follow the requirements shown in the account if Google changes them. See [Google's current testing requirement](https://support.google.com/googleplay/android-developer/answer/14151465).
8. After production access and review are approved, promote the tested release to production with a small staged percentage, monitor Android vitals/sign-in/support, then increase the rollout deliberately to 100%. Do not upload a different untested AAB for production.

## Store-build smoke test

Use physical devices and install from the Play internal or closed testing opt-in link—not Expo Go, a development client, or a sideloaded preview APK. Test both an admin and player account without using real child data.

- [ ] Fresh install and upgrade from the prior track build both launch without a crash; version/package shown by Android is correct.
- [ ] Google Sign-In succeeds, returns to the app, survives restart, and signs out cleanly. Repeat on a device/account that never installed a debug build.
- [ ] Family summary loads correct members, roles, open chores, and avatars through the production `/api/v1` base URL.
- [ ] Player completes an assigned chore; admin sees the submission and approves it; the chore reaches Approved only once.
- [ ] Approved coins appear exactly once in the player's wallet/ledger; balance stays consistent after refresh and restart.
- [ ] Realtime Feed updates on the second device without manual refresh and reconnects after airplane mode/backgrounding.
- [ ] `familychores://` opens the installed app from an ADB/link test and routes safely when signed in and signed out.
- [ ] Switch among `fr-FR`, `en-US`, and `es-US`; restart after each switch and check navigation, chores, approvals, wallet, and Feed for translated copy/layout.
- [ ] Network failures, expired sessions, rejected chores, and insufficient funds show recoverable UI without exposing private data.
- [ ] Verify icon masking, Android 12+ splash, status/navigation bars, back behavior, rotation policy, and accessibility font scaling on phone and tablet.

## Data Safety worksheet

Treat this as a preparation worksheet, not a legal determination. Re-audit the exact production binary and every bundled SDK immediately before submission. Answers must match the live `/privacy-policy` document; update the policy first if actual behavior differs.

| Play data category | App examples | Collected? | Shared? | Purpose / handling to verify |
| --- | --- | --- | --- | --- |
| Personal info: name, email, user IDs | Google sign-in; parent/admin and child profiles; invitations | Yes | Limited | App functionality, authentication, account/family management. Verify Play's service-provider and user-initiated-transfer exceptions before answering “shared.” |
| Photos | Google profile-photo reference and child avatars | Yes | Limited | Profile/avatar display. Family Friends can expose a child's first name/avatar only after parent-controlled connection, as stated in the policy. |
| App activity / user-generated content | Chores, submissions, approvals/rejections, rewards, achievements, routines, support requests, family Feed | Yes | Limited | Core functionality, safety/support, auditing, product improvement. Activity can be `FAMILY_PRIVATE` or `CHILD_SENSITIVE`. |
| Financial info | Virtual coins/wallet ledger only | Review | No sale | Confirm with Play whether non-monetary virtual currency belongs in this category; do not imply real payment-card or bank data is collected if it is not. |
| App info and performance / device identifiers | Session state, device/browser identifiers, best-effort diagnostics | Yes | Service providers | Security, reliability, diagnostics, fraud prevention. Confirm production logging, crash tooling, retention, and SDK behavior. |
| Contacts, location, health, messages, audio, files, calendar | No corresponding Android runtime permission or mobile feature found | No, subject to final SDK audit | No | Optional Google Tasks is account data handled by the web service; verify whether the Android release exposes it and classify it accurately if it does. |

Additional form checks:

- Data is encrypted in transit; verify every production API and Socket.IO URL uses HTTPS/WSS.
- Users can request family export and scheduled deletion in the app. Confirm Play's account-deletion requirement is satisfied by an accessible web URL as well as the in-app flow, and add that URL in Play Console if requested.
- The privacy policy says no sale of personal information. Do not select advertising purposes unless the binary changes.
- Inventory all third-party SDK behavior, especially Google Sign-In, Expo/React Native, cloud hosting, database, email/support, and any future analytics/crash SDK. Processors may qualify for Play's service-provider exception, but the declaration is the developer's responsibility.
- CHILD_SENSITIVE data includes child names, avatars, activity history, preferences, and login/session activity. Do not use real family data in screenshots, reviewer instructions, or test accounts.

See [Google's Data Safety guidance](https://support.google.com/googleplay/android-developer/answer/10787469) and the repository's canonical privacy content at `apps/web/src/legal/privacy-policy.json`.

## Families, target audience, and content rating

- Declare the audience truthfully. This is a family-participation app with child/player accounts and parent oversight; selecting any child age group triggers the [Google Play Families Policy requirements](https://support.google.com/googleplay/android-developer/answer/9867159).
- Decide whether to opt into **Designed for Families/Teacher Approved** separately from declaring child-inclusive target ages. Do not claim participation until all eligibility and review requirements are met.
- No ads SDK was found in the Android app. Keep it that way unless a Families self-certified SDK and compliant age treatment are deliberately introduced. Re-check transitive SDKs before answering the ads declaration.
- Provide reviewer access that demonstrates parent consent, role separation, Family Friends controls, and deletion/export without exposing a real child. Ensure child-accessible content, links, data collection, and social features meet the Families rules in every supported locale.
- Complete the IARC questionnaire in **Policy and programs → App content → Content ratings** based on actual content and interactions. Include user interaction/content sharing where the Feed or Family Friends questionnaire asks; do not guess a desired rating. Review the generated regional ratings and appeal/correct any inaccurate answer before rollout. See [Google's content-rating guidance](https://support.google.com/googleplay/android-developer/answer/9859655).

## Store listing asset inventory

Create and upload only sanitized, production-accurate assets:

- [ ] App title and support/contact details.
- [ ] Short description (Play limit: 80 characters) and full description (Play limit: 4,000 characters), reviewed for child/family claims and localized as desired.
- [ ] 512×512 Play Store icon. A source exists, but export/validate it against current Play icon specifications and do not use real user data.
- [ ] 1024×500 feature graphic.
- [ ] At least the required phone screenshots; add enough to show parent and player outcomes without private data.
- [ ] 7-inch and 10-inch tablet screenshots if those form factors are supported/listed.
- [ ] Dedicated adaptive-icon foreground with safe-zone padding, plus device verification across circle/squircle/rounded-square masks.
- [ ] Live privacy-policy URL: the deployed canonical origin plus `/privacy-policy`.
- [ ] Optional localized listing text/screenshots for `fr-FR`, `en-US`, and `es-US`; do not publish machine-generated legal or policy claims without review.

Store assets, Play Console records, verification documents, tester lists, service-account keys, OAuth credentials, and uploads are intentionally not created or stored in this repository.
