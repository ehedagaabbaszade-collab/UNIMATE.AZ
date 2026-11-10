"use client";

import { LOCALE_COOKIE, changeLocale, type Locale } from "@unimate/i18n";
import { writeCookie } from "@/lib/cookies";
import { getBrowserClient } from "@/lib/supabase/browser";

/** Local copy of the choice: cookie (read by server rendering) + <html lang>. */
export function applyLocaleLocally(l: Locale): void {
  writeCookie(LOCALE_COOKIE, l);
  document.documentElement.lang = l;
}

/**
 * Writes profiles.locale (the database stamps locale_set_at) and mirrors it into auth user metadata, which
 * Supabase auth emails read ({{ .Data.locale }}). Resolves false on failure; never throws
 * (also resolves false when Supabase is not configured).
 */
export async function writeProfileLocale(l: Locale, userId: string): Promise<boolean> {
  try {
    const sb = getBrowserClient();
    const { error } = await sb.from("profiles").update({ locale: l }).eq("id", userId);
    if (error) return false;
    await sb.auth.updateUser({ data: { locale: l } }).catch(() => undefined); // best effort: only emails depend on it
    return true;
  } catch {
    return false;
  }
}

/**
 * The single entry point for an explicit language choice (settings, onboarding, switcher).
 * Local copy first so the UI changes immediately; the profile write follows when signed in.
 */
export async function persistLocale(l: Locale, userId: string | null): Promise<boolean> {
  const plan = changeLocale(l, userId !== null);
  if (plan.shouldWriteLocal) applyLocaleLocally(l);
  if (plan.shouldWriteProfile && userId) return writeProfileLocale(l, userId);
  return true;
}
