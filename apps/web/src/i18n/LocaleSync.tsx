"use client";

import { LOCALE_COOKIE, reconcileLocale } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { readCookie } from "@/lib/cookies";
import { applyLocaleLocally, writeProfileLocale } from "./client";

/**
 * Mounted once in signed-in layouts. Reconciles the cookie / device language with profiles.locale
 * (rules: reconcileLocale in @unimate/i18n) and refreshes server rendering only when the language changes.
 * Server components cannot set cookies, so this has to run on the client.
 */
export function LocaleSync({ userId, profileLocale, localeSetAt }: { userId: string; profileLocale: string | null; localeSetAt: string | null }) {
  const { locale } = useI18n();
  const router = useRouter();
  useEffect(() => {
    const r = reconcileLocale({
      profile: { locale: profileLocale, localeSetAt },
      storedLocale: readCookie(LOCALE_COOKIE),
      deviceLocales: navigator.languages,
    });
    if (r.shouldWriteLocal) applyLocaleLocally(r.effective);
    if (r.shouldWriteProfile) void writeProfileLocale(r.effective, userId);
    if (r.effective !== locale) router.refresh();
    // `locale` is deliberately not a dependency: it changes as a result of this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, profileLocale, localeSetAt]);
  return null;
}
