import type { Messages } from "./catalogs";
import type { Locale } from "./locales";
import { formatMessage, type Params } from "./message";

// Catalog-free translation helpers: importing this module never pulls the four catalogs into a client bundle.
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

/** Translator over ONE given catalog (no other locales referenced): lets a client bundle ship only the active language. */
export const translatorFor = (locale: Locale, messages: Messages): Translate => (key, params) => {
  const raw = lookup(messages, key);
  return raw === undefined ? key : formatMessage(raw, locale, params);
};
