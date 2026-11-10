# UNIMATE.AZ mobile (Expo SDK 58, React Native 0.88, Expo Router)

Status (honest): TypeScript compiles, pure logic is unit-tested (vitest), and the JS bundles for Android and iOS build
(`expo export`). **Nothing has been run on a device or emulator, and no APK/IPA has been built.** All Supabase-backed
behaviour is untested against a live project.

## Versions
Expo `~58.0.23`, React Native `0.88.1`, **React `19.3.0` exactly** (the RN 0.88 renderer checks the exact version).
`apps/web` and `apps/admin` use React 19.3.1, so this app has its own `node_modules/react@19.3.0`, and `metro.config.js`
forces every `react` import (including from hoisted packages and `packages/*`) to that copy. `expo-doctor` therefore
reports "duplicate react" (web/admin vs mobile); this is expected. Proof: the exported bundle contains no `19.3.1`.

## Setup
```
npm install                      # from the repo root
cp apps/mobile/.env.example apps/mobile/.env   # fill EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY
npm run start -w @unimate/mobile  # dev server (needs a dev build or Expo Go for JS-only checks)
```
Only the public URL and anon key are read. They are bundled into the app: never put a service-role key here.
Without them the app shows a "Backend not configured" screen and no data (no fake data).

Supabase dashboard (Authentication > URL Configuration > Redirect URLs): add `unimate://auth/callback`
(and the `exp://...` URL if you test in Expo Go). Auth uses PKCE; email links return to that deep link.

## Checks
```
npx tsc --noEmit -p apps/mobile
npx vitest run apps/mobile
cd apps/mobile && npx expo export --platform android && npx expo export --platform ios   # writes dist/ (git-ignored)
cd apps/mobile && npx expo-doctor
```

## Build and submit (EAS cloud; I did not run any of this)
External requirements: an Expo (EAS) account, for Android a Google Play Console account ($25 one-time) and for iOS an
Apple Developer Program membership ($99/year). A Mac is **not** required: EAS builds iOS in the cloud, but the Apple
account is needed for signing. Replace the placeholder identifiers `az.unimate.app` (iOS `bundleIdentifier`,
Android `package`) in `app.json` if you want different ones, before the first store build.

```
npm i -g eas-cli
cd apps/mobile
eas login
eas init                                   # links the project, writes extra.eas.projectId into app.json
# .env is git-ignored and NOT uploaded by EAS: define the two PUBLIC values per EAS environment (visibility "plaintext" is fine;
# they end up in the app binary anyway). Each eas.json profile selects its environment through "environment".
eas env:create --name EXPO_PUBLIC_SUPABASE_URL --value <url> --environment production --environment preview --visibility plaintext
eas env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon key> --environment production --environment preview --visibility plaintext
# (verify the exact flags with `eas env:create --help`; older eas-cli versions used `eas secret:create`)

# Android
eas build --platform android --profile preview       # installable APK for testers
eas build --platform android --profile production    # AAB for Google Play
eas submit --platform android --profile production   # first upload must be done manually in Play Console; later ones can use a service-account key

# iOS
eas build --platform ios --profile production        # prompts for Apple credentials, creates certs/profiles
eas submit --platform ios --profile production       # uploads to App Store Connect / TestFlight
```
Profiles (`eas.json`): `development` (dev client, simulator/APK), `preview` (internal APK), `production` (AAB, auto-increment).
Store listing, privacy questionnaire, screenshots and review are manual. Legal pages in the app are drafts for legal review.

## Structure
- `app/` Expo Router routes: `(auth)` signed-out, `(app)` signed-in (`(tabs)` + pushed screens), `auth/callback`, `reset-password`.
- `src/lib/registry.ts` is the **module registry**: tabs, Home tiles and Home hero cards are derived from it.
  To add Campus/Notes/Career/Gamification: create the screens (`app/(app)/(tabs)/<route>.tsx` for a tab, `app/(app)/<route>.tsx`
  otherwise), add one entry to `MODULES` (with `tabRoute`/`tileOrder`/`hero`) and its catalog keys. Nothing else changes; the
  mockup's five-tab bar (Home + at most 3 module tabs chosen by `tabPriority` + Profile; Planner yields its tab to Campus/Career
  but stays reachable from its tile and hero card) and the 3x3 grid (more than 9 tiles become 8 + a "More" tile) are enforced and
  unit-tested in `registry.test.ts`. Nothing is listed before its screens exist. A tab file that does not fit the bar is declared
  hidden in `app/(app)/(tabs)/_layout.tsx` (automatic for registry entries).
- `src/lib/*` pure logic with tests (copied from the web feature modules where the web ones use the `@/` alias: edge client
  mapping, quiz/citation/upload helpers, schedule, usage, GPA; do not import `apps/web` code directly, except the legal content
  module which is pure data).
- Language: `src/state/locale.tsx` (az default, device language, `reconcileLocale`, writes `profiles.locale`).
- Strings: `packages/i18n` (`mobile.*` namespace added to all four catalogs). `src/lib/hardcoded.test.ts` scans for literals.

## Known gaps
- Home shows only values the backend has: XP (sum of `xp_events`), streak (`streaks`). There is no level, achievement or overall
  percentage in the database, so those rows from the design mockup are hidden, not invented.
- Images: the picker is present but the private `documents` bucket accepts only PDF/DOCX/PPTX, so images are rejected with a message.
- Date/time entry in the planner is typed text (`YYYY-MM-DD HH:mm`); a native picker is a follow-up.
- Pomodoro XP is an on-screen estimate (no client-callable XP award exists for focus sessions), as on web.
- Reminders are local notifications scheduled while the app is open and the schedule is loaded; no push server.
- Brand artwork is the generated PNG set; the light header uses the mark plus the wordmark as text (no official light lockup).
