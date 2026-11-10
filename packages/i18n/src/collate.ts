import { bcp47, type Locale } from "./locales";

const collators = new Map<Locale, Intl.Collator>();
/**
 * Locale collator (numeric aware). az: c < ç, e < ə, g < ğ, h < x < ı < i, o < ö, s < ş, u < ü;
 * tr: ı before i, ç ğ ö ş ü after their base letters; ru Cyrillic alphabetical; en plain Latin.
 * Needs full ICU (browsers, Node, Hermes with Intl); the collation tests catch a runtime that lacks it.
 */
export function getCollator(l: Locale): Intl.Collator {
  let c = collators.get(l);
  if (!c) collators.set(l, (c = new Intl.Collator(bcp47(l), { numeric: true })));
  return c;
}
export const compareStrings = (l: Locale, a: string, b: string): number => getCollator(l).compare(a, b);
/** Sorted copy; pass `key` to sort objects (university or course names, ...). */
export function sortStrings<T>(l: Locale, items: readonly T[], key: (item: T) => string = (x) => String(x)): T[] {
  const c = getCollator(l);
  return [...items].sort((a, b) => c.compare(key(a), key(b)));
}
