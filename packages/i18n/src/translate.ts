import { catalogs, type Messages } from "./catalogs";
import { DEFAULT_LOCALE, type Locale } from "./locales";
import { formatMessage, type Params } from "./message";

type Join<K extends string, P extends string> = `${K}.${P}`;
type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : Join<K, Paths<T[K]>>;
}[keyof T & string];
/** Every leaf key of the catalog as a dotted path, e.g. "auth.signInTitle". */
export type MessageKey = Paths<Messages>;
export type Translate = (key: MessageKey, params?: Params) => string;

/** Raw lookup. Returns undefined for a missing key or a non-leaf path. */
export function lookup(messages: Messages, key: string): string | undefined {
  let cur: unknown = messages;
  for (const part of key.split(".")) {
    if (cur && typeof cur === "object" && Object.hasOwn(cur, part)) cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return typeof cur === "string" ? cur : undefined;
}

/** Translate `key` for `locale`. A missing key falls back to az, then to the key itself (visible, never throws). */
export function t(locale: Locale, key: MessageKey, params?: Params): string {
  const raw = lookup(catalogs[locale], key) ?? lookup(catalogs[DEFAULT_LOCALE], key);
  return raw === undefined ? key : formatMessage(raw, locale, params);
}

export const createTranslator = (locale: Locale): Translate => (key, params) => t(locale, key, params);

/** Dynamic key (e.g. a server-provided status): `fallback` when the key does not exist. */
export function tryTranslate(locale: Locale, key: string, fallback: string, params?: Params): string {
  const raw = lookup(catalogs[locale], key);
  return raw === undefined ? fallback : formatMessage(raw, locale, params);
}
