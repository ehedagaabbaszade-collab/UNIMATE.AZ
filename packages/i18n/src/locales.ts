/** Supported UI languages. Order is the order shown in language selectors (az first: it is the default). */
export const LOCALES = ["az", "tr", "en", "ru"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "az";

/** Cookie used on web to carry the choice to server rendering. Mobile uses its own local storage key. */
export const LOCALE_COOKIE = "um-locale";
/** Endonyms: each language is always shown in itself, never translated. */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = { az: "Azərbaycanca", tr: "Türkçe", en: "English", ru: "Русский" };

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (LOCALES as readonly string[]).includes(v);
/** Strict: exact supported code or the default. For raw language tags use `localeFromTag`. */
export const toLocale = (v: unknown): Locale => (isLocale(v) ? v : DEFAULT_LOCALE);

/** BCP-47 tags for Intl. az-Latn-AZ pins the Latin script and Azerbaijani month names. */
const BCP47: Readonly<Record<Locale, string>> = { az: "az-Latn-AZ", tr: "tr-TR", en: "en-GB", ru: "ru-RU" };
export const bcp47 = (l: Locale): string => BCP47[l];

/**
 * Maps any language tag to a supported locale by its primary language subtag:
 * "ru-RU" -> ru, "tr_TR" -> tr, "az-Latn-AZ" -> az, "EN-us" -> en. Returns null when unsupported.
 */
export function localeFromTag(tag: unknown): Locale | null {
  if (typeof tag !== "string") return null;
  const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
  return isLocale(primary) ? primary : null;
}
