"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { catalogs, type Messages } from "./catalogs";
import { compareStrings, sortStrings } from "./collate";
import { formatCurrency, formatDate, formatDateTime, formatNumber, formatPercent, formatRelativeTime, formatTime } from "./format";
import type { Locale } from "./locales";
import { createTranslator, type Translate } from "./translate";

type DateInput = Date | string | number;
export interface I18nValue {
  locale: Locale;
  messages: Messages;
  t: Translate;
  date: (d: DateInput, opts?: Intl.DateTimeFormatOptions) => string;
  time: (d: DateInput, opts?: Intl.DateTimeFormatOptions) => string;
  dateTime: (d: DateInput, opts?: Intl.DateTimeFormatOptions) => string;
  relativeTime: (d: DateInput, now?: DateInput) => string;
  number: (n: number, opts?: Intl.NumberFormatOptions) => string;
  percent: (fraction: number, opts?: Intl.NumberFormatOptions) => string;
  currency: (amount: number, currency?: string, opts?: Intl.NumberFormatOptions) => string;
  compare: (a: string, b: string) => number;
  sort: <T>(items: readonly T[], key?: (item: T) => string) => T[];
}
const Ctx = createContext<I18nValue | null>(null);

/**
 * Pure provider: the caller decides the locale (web: cookie read by the server layout; mobile/admin: their own state).
 * It does no storage or network access. Persistence and sync live in the app (see docs/I18N.md).
 */
export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo<I18nValue>(
    () => ({
      locale,
      messages: catalogs[locale],
      t: createTranslator(locale),
      date: (d, o) => formatDate(locale, d, o),
      time: (d, o) => formatTime(locale, d, o),
      dateTime: (d, o) => formatDateTime(locale, d, o),
      relativeTime: (d, now) => formatRelativeTime(locale, d, now),
      number: (n, o) => formatNumber(locale, n, o),
      percent: (f, o) => formatPercent(locale, f, o),
      currency: (a, c, o) => formatCurrency(locale, a, c, o),
      compare: (a, b) => compareStrings(locale, a, b),
      sort: (items, key) => sortStrings(locale, items, key),
    }),
    [locale],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n must be used inside <I18nProvider>");
  return v;
}
export const useT = (): Translate => useI18n().t;
export const useLocale = (): Locale => useI18n().locale;
