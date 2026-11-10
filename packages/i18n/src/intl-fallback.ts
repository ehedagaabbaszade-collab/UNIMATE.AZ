import type { Locale } from "./locales";

/**
 * Hermes (React Native / Expo Go) ships Intl.Collator, NumberFormat and DateTimeFormat but NOT
 * PluralRules, RelativeTimeFormat or ListFormat. These pure fallbacks cover az/tr/en/ru (CLDR cardinal
 * rules for integers) and are used only when the native API is missing; engines that have it keep using it.
 */
export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

export function fallbackPluralCategory(locale: Locale, n: number): PluralCategory {
  if (locale === "ru") {
    if (!Number.isInteger(n)) return "other";
    const a = Math.abs(n);
    const m10 = a % 10;
    const m100 = a % 100;
    if (m10 === 1 && m100 !== 11) return "one";
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "few";
    return "many";
  }
  // az, tr, en: "one" for exactly 1 (en additionally requires an integer; az/tr treat 1 and 1.0 alike).
  return Math.abs(n) === 1 ? "one" : "other";
}

type Unit = "year" | "month" | "week" | "day" | "hour" | "minute" | "second";

// [one, few, many, other] (non-ru locales only use one/other: index 0 and 3).
const NOUNS: Record<Locale, Record<Unit, [string, string, string, string]>> = {
  az: {
    year: ["il", "il", "il", "il"], month: ["ay", "ay", "ay", "ay"], week: ["həftə", "həftə", "həftə", "həftə"],
    day: ["gün", "gün", "gün", "gün"], hour: ["saat", "saat", "saat", "saat"], minute: ["dəqiqə", "dəqiqə", "dəqiqə", "dəqiqə"],
    second: ["saniyə", "saniyə", "saniyə", "saniyə"],
  },
  tr: {
    year: ["yıl", "yıl", "yıl", "yıl"], month: ["ay", "ay", "ay", "ay"], week: ["hafta", "hafta", "hafta", "hafta"],
    day: ["gün", "gün", "gün", "gün"], hour: ["saat", "saat", "saat", "saat"], minute: ["dakika", "dakika", "dakika", "dakika"],
    second: ["saniye", "saniye", "saniye", "saniye"],
  },
  en: {
    year: ["year", "year", "year", "years"], month: ["month", "month", "month", "months"], week: ["week", "week", "week", "weeks"],
    day: ["day", "day", "day", "days"], hour: ["hour", "hour", "hour", "hours"], minute: ["minute", "minute", "minute", "minutes"],
    second: ["second", "second", "second", "seconds"],
  },
  ru: {
    year: ["год", "года", "лет", "года"], month: ["месяц", "месяца", "месяцев", "месяца"], week: ["неделя", "недели", "недель", "недели"],
    day: ["день", "дня", "дней", "дня"], hour: ["час", "часа", "часов", "часа"], minute: ["минута", "минуты", "минут", "минуты"],
    second: ["секунда", "секунды", "секунд", "секунды"],
  },
};

const NOW: Record<Locale, string> = { az: "indi", tr: "şimdi", en: "now", ru: "сейчас" };

/** Signed relative time ("3 days ago" / "in 2 hours") without Intl.RelativeTimeFormat. */
export function fallbackRelativeTime(locale: Locale, value: number, unit: Unit): string {
  if (value === 0 && unit === "second") return NOW[locale];
  const n = Math.abs(value);
  const cat = fallbackPluralCategory(locale, n);
  const idx = cat === "one" ? 0 : cat === "few" ? 1 : cat === "many" ? 2 : 3;
  const noun = NOUNS[locale][unit][idx]!;
  const past = value < 0 || Object.is(value, -0);
  switch (locale) {
    case "az": return `${n} ${noun} ${past ? "əvvəl" : "sonra"}`;
    case "tr": return `${n} ${noun} ${past ? "önce" : "sonra"}`;
    case "en": return past ? `${n} ${noun} ago` : `in ${n} ${noun}`;
    case "ru": return past ? `${n} ${noun} назад` : `через ${n} ${noun}`;
  }
}

const AND: Record<Locale, string> = { az: "və", tr: "ve", en: "and", ru: "и" };

/** "a, b and c" without Intl.ListFormat (English uses the serial comma, as ListFormat does). */
export function fallbackList(locale: Locale, items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} ${AND[locale]} ${items[1]}`;
  const head = items.slice(0, -1).join(", ");
  return `${head}${locale === "en" ? "," : ""} ${AND[locale]} ${items[items.length - 1]}`;
}
