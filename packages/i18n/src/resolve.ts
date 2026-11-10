import { DEFAULT_LOCALE, isLocale, localeFromTag, type Locale } from "./locales";

export interface ResolveInput {
  /** profiles.locale. Pass only when authenticated. */
  profileLocale?: unknown;
  /** Locale persisted on this device (cookie / AsyncStorage / localStorage). */
  storedLocale?: unknown;
  /** Device/browser preference list, most preferred first (navigator.languages, expo-localization). */
  deviceLocales?: readonly string[] | null;
}

/** First supported language in a device preference list ("ru-RU" -> ru), or null. */
export function localeFromDevice(deviceLocales?: readonly string[] | null): Locale | null {
  for (const tag of deviceLocales ?? []) {
    const l = localeFromTag(tag);
    if (l) return l;
  }
  return null;
}

/** Pure. profile > stored > device > az. Unknown values at any level are skipped, never thrown on. */
export function resolveLocale(input: ResolveInput): Locale {
  if (isLocale(input.profileLocale)) return input.profileLocale;
  const stored = localeFromTag(input.storedLocale);
  if (stored) return stored;
  return localeFromDevice(input.deviceLocales) ?? DEFAULT_LOCALE;
}

export interface ReconcileInput {
  /** null = signed out. `localeSetAt` is profiles.locale_set_at (null = never explicitly chosen). */
  profile: { locale: unknown; localeSetAt: string | null } | null;
  storedLocale?: unknown;
  deviceLocales?: readonly string[] | null;
}
export interface ReconcileResult {
  effective: Locale;
  shouldWriteProfile: boolean;
  shouldWriteLocal: boolean;
}

/**
 * What to show and what to persist when the app starts or the session changes.
 *  - signed out: local choice, else device, else az. Nothing is written.
 *  - signed in, profile locale explicitly set: the profile wins; the local copy is refreshed to match.
 *  - signed in, profile never set (locale_set_at null): the local/device choice is pushed to the profile
 *    (only if there is a real local/device choice; a bare az default is not turned into a "choice").
 */
export function reconcileLocale(input: ReconcileInput): ReconcileResult {
  const stored = localeFromTag(input.storedLocale);
  const device = localeFromDevice(input.deviceLocales);
  const local = stored ?? device;
  if (!input.profile) return { effective: local ?? DEFAULT_LOCALE, shouldWriteProfile: false, shouldWriteLocal: false };

  const profileLocale = isLocale(input.profile.locale) ? input.profile.locale : DEFAULT_LOCALE;
  if (input.profile.localeSetAt) {
    return { effective: profileLocale, shouldWriteProfile: false, shouldWriteLocal: stored !== profileLocale };
  }
  if (local) return { effective: local, shouldWriteProfile: true, shouldWriteLocal: stored !== local };
  return { effective: profileLocale, shouldWriteProfile: false, shouldWriteLocal: stored !== profileLocale };
}

/** An explicit user choice (selector in settings/onboarding): always saved locally, and to the profile when signed in. */
export function changeLocale(next: Locale, signedIn: boolean): ReconcileResult {
  return { effective: next, shouldWriteProfile: signedIn, shouldWriteLocal: true };
}
