"use client";

import { LOCALE_COOKIE, isLocale } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { readCookie } from "../lib/cookies";
import { getBrowserClient } from "../lib/supabase/browser";
import { applyLocaleLocally } from "./client";

/**
 * Staff language follows the account (profiles.locale) across devices: when no device language was chosen yet, adopt
 * the account language and refresh server rendering. Explicit changes in the switcher write the profile (persistLocale).
 */
export function LocaleSync({ userId }: { userId: string }) {
  const { locale } = useI18n();
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await getBrowserClient().from("profiles").select("locale").eq("id", userId).maybeSingle<{ locale: string }>();
        const remote = data?.locale;
        if (cancelled || !remote || !isLocale(remote)) return;
        if (readCookie(LOCALE_COOKIE) === null && remote !== locale) {
          applyLocaleLocally(remote);
          router.refresh();
        }
      } catch {
        /* the cookie language stays */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  return null;
}
