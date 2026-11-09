import { az } from "./messages/az";
import { en, type Messages } from "./messages/en";
import { ru } from "./messages/ru";
import { tr } from "./messages/tr";

export const LOCALES = ["az", "en", "ru", "tr"] as const;
export type AppLocale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = "az";
export const LOCALE_COOKIE = "um-locale";
export const LOCALE_NAMES: Record<AppLocale, string> = { az: "Azərbaycanca", en: "English", ru: "Русский", tr: "Türkçe" };

export const catalogs: Record<AppLocale, Messages> = { az, en, ru, tr };
export type { Messages };

export const isLocale = (v: unknown): v is AppLocale => typeof v === "string" && (LOCALES as readonly string[]).includes(v);
export const toLocale = (v: unknown): AppLocale => (isLocale(v) ? v : DEFAULT_LOCALE);

/** profiles.locale only allows az/en/ru (see migration 0300), so Turkish is stored as English there. */
export const toProfileLocale = (l: AppLocale): "az" | "en" | "ru" => (l === "tr" ? "en" : l);

type Join<K extends string, P extends string> = `${K}.${P}`;
type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : Join<K, Paths<T[K]>>;
}[keyof T & string];
export type MessageKey = Paths<Messages>;

export type Params = Record<string, string | number>;

export function lookup(messages: Messages, key: string): string {
  let cur: unknown = messages;
  for (const part of key.split(".")) {
    if (cur && typeof cur === "object" && part in cur) cur = (cur as Record<string, unknown>)[part];
    else return key;
  }
  return typeof cur === "string" ? cur : key;
}

export function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

export type Translate = (key: MessageKey, params?: Params) => string;
export function createTranslator(locale: AppLocale): Translate {
  const messages = catalogs[locale];
  return (key, params) => interpolate(lookup(messages, key), params);
}

/** Dynamic key (e.g. a server-provided status) that falls back to `fallback` when absent. */
export function tryTranslate(messages: Messages, key: string, fallback: string): string {
  const v = lookup(messages, key);
  return v === key ? fallback : v;
}

// Locale-aware formatting (Intl). BCP-47 tags: az-Latn-AZ keeps Latin script and Azerbaijani month names.
const BCP47: Record<AppLocale, string> = { az: "az-Latn-AZ", en: "en-GB", ru: "ru-RU", tr: "tr-TR" };
export const bcp47 = (l: AppLocale) => BCP47[l];

export const formatNumber = (l: AppLocale, n: number, opts?: Intl.NumberFormatOptions) => new Intl.NumberFormat(BCP47[l], opts).format(n);
export const formatDate = (l: AppLocale, d: Date | string | number, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) =>
  new Intl.DateTimeFormat(BCP47[l], opts).format(new Date(d));
export const formatDateTime = (l: AppLocale, d: Date | string | number) => formatDate(l, d, { dateStyle: "medium", timeStyle: "short" });
export const formatBytes = (l: AppLocale, bytes: number): string => {
  if (bytes < 1024) return `${formatNumber(l, bytes)} B`;
  if (bytes < 1024 * 1024) return `${formatNumber(l, bytes / 1024, { maximumFractionDigits: 0 })} KB`;
  return `${formatNumber(l, bytes / (1024 * 1024), { maximumFractionDigits: 1 })} MB`;
};
/** Locale-aware list ("a, b and c"). */
export const formatList = (l: AppLocale, items: string[]) => new Intl.ListFormat(BCP47[l], { style: "long", type: "conjunction" }).format(items);

/** The generation endpoint accepts an allowlisted language CODE (az|tr|ru|en), never free text. */
export const aiLanguage = (l: AppLocale): AppLocale => l;
