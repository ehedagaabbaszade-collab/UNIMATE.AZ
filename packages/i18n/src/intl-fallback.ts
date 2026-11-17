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

// ---- Date/time names for engines whose bundled ICU lacks the locale (e.g. Chrome without `az`) ----
const sp = (s: string) => s.split(" ");
const NAMES: Record<Exclude<Locale, "en">, { ml: string[]; ms: string[]; mn?: string[]; wl: string[]; ws: string[] }> = {
  az: {
    ml: sp("yanvar fevral mart aprel may iyun iyul avqust sentyabr oktyabr noyabr dekabr"),
    ms: sp("yan fev mar apr may iyn iyl avq sen okt noy dek"),
    wl: ["bazar ertəsi", "çərşənbə axşamı", "çərşənbə", "cümə axşamı", "cümə", "şənbə", "bazar"],
    ws: ["B.e.", "Ç.a.", "Ç.", "C.a.", "C.", "Ş.", "B."],
  },
  tr: {
    ml: sp("Ocak Şubat Mart Nisan Mayıs Haziran Temmuz Ağustos Eylül Ekim Kasım Aralık"),
    ms: sp("Oca Şub Mar Nis May Haz Tem Ağu Eyl Eki Kas Ara"),
    wl: sp("Pazartesi Salı Çarşamba Perşembe Cuma Cumartesi Pazar"),
    ws: sp("Pzt Sal Çar Per Cum Cmt Paz"),
  },
  ru: {
    ml: sp("января февраля марта апреля мая июня июля августа сентября октября ноября декабря"),
    ms: sp("янв. февр. мар. апр. мая июн. июл. авг. сент. окт. нояб. дек."),
    mn: sp("январь февраль март апрель май июнь июль август сентябрь октябрь ноябрь декабрь"),
    wl: sp("понедельник вторник среда четверг пятница суббота воскресенье"),
    ws: sp("пн вт ср чт пт сб вс"),
  },
};

/** True when Intl.DateTimeFormat has no real data for the locale (it silently falls back to root: "M11 17"). */
const probed = new Map<string, boolean>();
/** Test hook: forget cached probe results. */
export const resetDateLocaleProbe = () => probed.clear();
/** True when the engine cannot really format dates for `tag`. Chrome claims "az" is supported (supportedLocalesOf and
 *  resolvedOptions both say az) yet has no data and prints root patterns like "M1 15, Wed", so probe the output too. */
export function dateLocaleUnsupported(tag: string): boolean {
  const hit = probed.get(tag);
  if (hit !== undefined) return hit;
  let bad: boolean;
  try {
    if (Intl.DateTimeFormat.supportedLocalesOf([tag]).length === 0) bad = true;
    else if (new Intl.DateTimeFormat(tag).resolvedOptions().locale.split("-")[0] !== tag.split("-")[0]) bad = true;
    else {
      const sample = new Date(Date.UTC(2020, 0, 15, 12));
      const local = new Intl.DateTimeFormat(tag, { month: "long", timeZone: "UTC" }).format(sample);
      bad = /^M\d+$/.test(local) || local === new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(sample);
    }
  } catch {
    bad = true;
  }
  probed.set(tag, bad);
  return bad;
}

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Manual CLDR-style date/time for az/tr/ru. Supports dateStyle/timeStyle and weekday/year/month/day/hour/minute/second. */
export function fallbackDateTime(l: Exclude<Locale, "en">, d: Date, o: Intl.DateTimeFormatOptions, timeZone: string): string {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", weekday: "short", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" }).formatToParts(d)) p[x.type] = x.value;
  const P = (k: string) => p[k] ?? "";
  const n = NAMES[l];
  const two = (v: string | number) => String(v).padStart(2, "0");
  const mi = Number(P("month")) - 1;
  const wi = WD.indexOf(P("weekday"));
  const ds = o.dateStyle;
  const ts = o.timeStyle;
  const styled = ds || ts;
  const f = {
    weekday: ds === "full" ? "long" : styled ? undefined : o.weekday,
    year: ds ? (ds === "short" && l !== "tr" && l !== "ru" ? "2-digit" : "numeric") : o.year,
    month: ds ? (ds === "short" ? "2-digit" : ds === "medium" ? "short" : "long") : o.month,
    day: ds ? (ds === "short" ? "2-digit" : "numeric") : o.day,
    hour: ts ? "2-digit" : o.hour,
    minute: ts ? "2-digit" : o.minute,
    second: ts === "medium" || ts === "long" || ts === "full" ? "2-digit" : styled ? undefined : o.second,
  };
  const textual = f.month === "short" || f.month === "long";
  const y = f.year ? (f.year === "2-digit" ? P("year").slice(-2) : P("year")) : "";
  const dd = f.day ? (f.day === "2-digit" ? two(P("day")) : String(Number(P("day")))) : "";
  const m = !f.month ? "" : textual ? (f.month === "long" ? (!dd && n.mn ? n.mn[mi]! : n.ml[mi]!) : n.ms[mi]!) : f.month === "2-digit" ? two(mi + 1) : String(mi + 1);
  let date = (textual ? [dd, m, y && (l === "ru" ? `${y} г.` : y)].filter(Boolean).join(" ") : [dd, m, y].filter(Boolean).join("."));
  if (f.weekday) {
    const w = (f.weekday === "long" ? n.wl : n.ws)[wi]!;
    date = !date ? w : l === "ru" ? `${w}, ${date}` : l === "tr" ? `${date} ${w}` : `${date}${ds === "full" ? "" : ","} ${w}`;
  }
  const time = f.hour || f.minute || f.second ? [f.hour && two(P("hour")), f.minute && two(P("minute")), f.second && two(P("second"))].filter(Boolean).join(":") : "";
  return [date, time].filter(Boolean).join(l === "tr" && !ts ? " " : ", ");
}
