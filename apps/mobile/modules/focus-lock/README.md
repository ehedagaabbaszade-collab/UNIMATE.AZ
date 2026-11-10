# UnimateFocusLock (local Expo module)

App blocking during focus sessions. iOS: Screen Time API (FamilyControls / ManagedSettings / DeviceActivity). Android: AccessibilityService plus a full-screen BlockActivity.

## Status: UNCOMPILED AND UNVERIFIED
Written on Windows. No Swift or Kotlin here has been compiled or run, and the config plugin has not been run through `expo prebuild`. Only `index.ts` is type-checked. Expect compile fixes on the first EAS or Xcode build.

## Requirements
- Development build / EAS build. It does NOT work in Expo Go (JS falls back to `supported:false`, `startBlocking` returns false).
- iOS: Apple must approve the **Family Controls (Distribution)** entitlement for the app ID and for the extension ID (request at developer.apple.com/contact/request/family-controls-distribution). Development entitlement works on devices for testing. iOS 16+. Real device only.
- Android: user must enable the accessibility service (Settings > Accessibility > UNIMATE Focus Lock). Google Play requires an Accessibility API declaration; the service only reads window-state package names.

## app.json (set by the main agent)
- `"plugins": [..., "./plugins/with-focus-lock"]`
- `ios.bundleIdentifier` should be `az.unimate.app` (App Group `group.az.unimate.app` is used in code and the entitlement).
- Autolinking: expo-modules-autolinking searches `<project>/modules` by default, so no `nativeModulesDir` setting is needed. After adding, run `npx expo prebuild --clean` / EAS build.

## Manual iOS step (not automated)
The DeviceActivityMonitor extension (`ios-extension/DeviceActivityMonitorExtension.swift`) is NOT added by the plugin. Editing the pbxproj to add an app-extension target reliably is not feasible without a real prebuild to test against. Without it, shields are not auto-cleared at `endAt` while the app is not running (the shield still clears on `stopBlocking`). Steps after `prebuild`:
1. Xcode: File > New > Target > Device Activity Monitor Extension, name `UnimateMonitor`, bundle id `az.unimate.app.monitor`.
2. Replace the generated class with `ios-extension/DeviceActivityMonitorExtension.swift`.
3. Give the extension target the capabilities Family Controls and App Groups (`group.az.unimate.app`).
4. Because `prebuild --clean` regenerates `ios/`, either commit the native project or use a plugin such as `@bacons/apple-targets` for the target.

## Behaviour notes
- `startBlocking` returns true only if authorization is granted and the selection is non-empty (iOS: and the shield is set; Android: accessibility service enabled and at least one app chosen).
- `setBlockedApps`/`listApps` are Android only; `pickApps` is iOS only (the iOS picker returns opaque tokens, so app names are not available).
- Android `requestAuthorization` opens one settings screen per call (accessibility first, then overlay). Call `getStatus()` after the user returns.
- Android blocking relies on the user not disabling the accessibility service. The block screen always shows an Emergency Exit button that stops blocking and returns home.
- Plugin omits FOREGROUND_SERVICE (no foreground service is used). PACKAGE_USAGE_STATS is declared but not used by the current code.
