# Mobile build (EAS)

Needs your accounts. **None of this was run**: no APK, AAB or IPA was built and the app was never run on a device. Only `expo export` for Android and iOS succeeded. More detail in `apps/mobile/README.md`.

## Config (`apps/mobile/app.json`)
Name `UNIMATE.AZ`, slug `unimate`, version `0.1.0`, scheme `unimate`. iOS `bundleIdentifier` and Android `package`: `az.unimate.app` (placeholder; confirm before the first store build, since store ids cannot change after publishing). `ITSAppUsesNonExemptEncryption` is false. Android permission: `POST_NOTIFICATIONS`. Locales az, tr, en, ru.

## eas.json (exists at `apps/mobile/eas.json`)
Profiles: `development` (dev client, internal; Android APK, iOS simulator), `preview` (internal, Android APK), `production` (auto-increment, Android app-bundle). `submit.production` is empty. Each profile selects the EAS environment of the same name. No secrets in it.

## Steps
```
npm i -g eas-cli
cd apps/mobile
eas login
eas init       # writes extra.eas.projectId into app.json
eas env:create --name EXPO_PUBLIC_SUPABASE_URL --value <url> --environment production --environment preview --visibility plaintext
eas env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon key> --environment production --environment preview --visibility plaintext
eas build --platform android --profile preview      # APK for testers
eas build --platform android --profile production   # AAB for Google Play
eas build --platform ios --profile production
eas submit --platform android --profile production
eas submit --platform ios --profile production
```
Verify flags with `eas env:create --help`. Only public values go in EAS env; they are bundled into the app.

## Accounts and requirements
- Expo account (EAS).
- Google Play Console (one-time fee). The first upload must be manual; later ones can use a service-account key.
- Apple Developer Program (annual fee). A Mac is not required for EAS cloud iOS builds; Apple credentials are needed for signing. TestFlight for iOS beta.
- A public privacy policy URL, store listing ([STORE_LISTING.md](STORE_LISTING.md)), screenshots. In-app legal pages are drafts for legal review.
- Supabase redirect URL `unimate://auth/callback`.
- Push: `expo-notifications` is installed but push delivery is not built; FCM/APNs credentials are not set up.

## OTA
`expo-updates` is not in the mobile dependencies and no update channel is configured, so OTA updates are not set up. That is a separate task; native changes always need a new binary.
