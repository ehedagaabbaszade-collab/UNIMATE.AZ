import { catalogs } from "./catalogs";
import { DEFAULT_LOCALE, type Locale } from "./locales";
import { formatMessage, type Params } from "./message";
import { lookup, type MessageKey, type Translate } from "./lookup";
export { lookup, translatorFor, type MessageKey, type Translate } from "./lookup";

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
