import { fallbackList, fallbackRelativeTime } from "./intl-fallback";
import { bcp47, type Locale } from "./locales";
import { APP_TIMEZONE } from "./timezone";

type DateInput = Date | string | number;
const toDate = (d: DateInput) => (d instanceof Date ? d : new Date(d));

export const formatNumber = (l: Locale, n: number, opts?: Intl.NumberFormatOptions) => new Intl.NumberFormat(bcp47(l), opts).format(n);
/** Fraction in, not percent: 0.256 -> "25.6%" (en) / "25,6 %" (ru). */
export const formatPercent = (l: Locale, fraction: number, opts?: Intl.NumberFormatOptions) =>
  new Intl.NumberFormat(bcp47(l), { style: "percent", maximumFractionDigits: 1, ...opts }).format(fraction);
/** Money, AZN by default. The manat sign shows for az; other locales show "AZN" (that is what CLDR says). */
export const formatCurrency = (l: Locale, amount: number, currency = "AZN", opts?: Intl.NumberFormatOptions) =>
  new Intl.NumberFormat(bcp47(l), { style: "currency", currency, ...opts }).format(amount);

export const formatDate = (l: Locale, d: DateInput, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) =>
  new Intl.DateTimeFormat(bcp47(l), { timeZone: APP_TIMEZONE, ...opts }).format(toDate(d));
export const formatTime = (l: Locale, d: DateInput, opts: Intl.DateTimeFormatOptions = { timeStyle: "short" }) =>
  new Intl.DateTimeFormat(bcp47(l), { timeZone: APP_TIMEZONE, ...opts }).format(toDate(d));
export const formatDateTime = (l: Locale, d: DateInput, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }) =>
  new Intl.DateTimeFormat(bcp47(l), { timeZone: APP_TIMEZONE, ...opts }).format(toDate(d));

const UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 86400],
  ["month", 30 * 86400],
  ["week", 7 * 86400],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];
/** "3 days ago" / "in 2 hours" in the locale, picking the largest sensible unit. `now` is injectable for tests. */
export function formatRelativeTime(l: Locale, d: DateInput, now: DateInput = new Date()): string {
  const diffSec = (toDate(d).getTime() - toDate(now).getTime()) / 1000;
  const rtf = typeof Intl.RelativeTimeFormat === "function" ? new Intl.RelativeTimeFormat(bcp47(l), { numeric: "auto" }) : null;
  const fmt = (v: number, unit: Intl.RelativeTimeFormatUnit) => (rtf ? rtf.format(v, unit) : fallbackRelativeTime(l, v, unit as Parameters<typeof fallbackRelativeTime>[2]));
  const abs = Math.abs(diffSec);
  for (const [unit, secs] of UNITS) {
    if (abs >= secs || unit === "second") return fmt(Math.round(diffSec / secs), unit);
  }
  return fmt(0, "second");
}

export const formatBytes = (l: Locale, bytes: number): string => {
  if (bytes < 1024) return `${formatNumber(l, bytes)} B`;
  if (bytes < 1024 * 1024) return `${formatNumber(l, bytes / 1024, { maximumFractionDigits: 0 })} KB`;
  return `${formatNumber(l, bytes / (1024 * 1024), { maximumFractionDigits: 1 })} MB`;
};
export const formatList = (l: Locale, items: string[]) =>
  typeof Intl.ListFormat === "function" ? new Intl.ListFormat(bcp47(l), { style: "long", type: "conjunction" }).format(items) : fallbackList(l, items);
