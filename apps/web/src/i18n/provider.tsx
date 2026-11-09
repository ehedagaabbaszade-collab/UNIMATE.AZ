"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { catalogs, createTranslator, formatDate, formatDateTime, formatNumber, type AppLocale, type Messages, type Translate } from "./index";

interface I18nValue {
  locale: AppLocale;
  messages: Messages;
  t: Translate;
  date: (d: Date | string | number, opts?: Intl.DateTimeFormatOptions) => string;
  dateTime: (d: Date | string | number) => string;
  number: (n: number, opts?: Intl.NumberFormatOptions) => string;
}
const Ctx = createContext<I18nValue | null>(null);

export function I18nProvider({ locale, children }: { locale: AppLocale; children: ReactNode }) {
  const value = useMemo<I18nValue>(
    () => ({
      locale,
      messages: catalogs[locale],
      t: createTranslator(locale),
      date: (d, opts) => formatDate(locale, d, opts),
      dateTime: (d) => formatDateTime(locale, d),
      number: (n, opts) => formatNumber(locale, n, opts),
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
export const useT = () => useI18n().t;
