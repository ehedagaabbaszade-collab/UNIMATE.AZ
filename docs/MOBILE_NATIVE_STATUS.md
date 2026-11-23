# Mobile native status

Founder decision 2026-11-23: focus-lock is kept. Build notes: [MOBILE_BUILD.md](MOBILE_BUILD.md). Release gates: [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).

| Item | Status |
| - | - |
| Focus-lock native module | Implemented, **uncompiled** (its README says so). Never run on a device |
| Expo Go | Falls back to `supported: false`; focus-lock cannot run there |
| Android mechanism | AccessibilityService + `SYSTEM_ALERT_WINDOW`; `PACKAGE_USAGE_STATS` is declared but unused |
| Google Play risk | Accessibility and overlay use is policy-sensitive; unused `PACKAGE_USAGE_STATS` should be removed or justified. No policy decision made |
| iOS mechanism | Family Controls / Screen Time API |
| iOS blockers | Needs the Family Controls distribution entitlement from Apple (not requested) and a DeviceActivityMonitor extension target (missing) |
| `eas.json` | Submit section empty |
| Store builds | None made. No EAS build, TestFlight or Play upload |
| Android emulator / adb | Not available on the dev machine |

## What is verified
Only JS-side logic and the unsupported fallback, by unit tests. Native behaviour is not verified.

## Next (Phase 5, not started)
1. Compile on EAS dev client for Android and iOS.
2. Decide Play policy stance; trim permissions.
3. Request the Apple entitlement; add the extension target.
4. Test on real devices, then update this file.

Mobile UI redesign notes: [TRANSFORMATION_PROGRESS.md](TRANSFORMATION_PROGRESS.md) (not re-checked on device after the Reanimated changes).
