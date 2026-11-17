import { catalogs, changeLocale, reconcileLocale, resolveLocale, type Locale } from "@unimate/i18n";
import { I18nProvider } from "@unimate/i18n/react";
import { getLocales } from "expo-localization";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { KEYS, kv } from "../lib/storage";
import { useSession } from "./session";

interface Ctx {
  locale: Locale;
  /** Explicit user choice: applied at once, saved locally, and to profiles.locale + auth metadata when signed in. */
  setLocale: (l: Locale) => Promise<boolean>;
}
const LocaleCtx = createContext<Ctx | null>(null);

const deviceLocales = (): string[] => getLocales().map((l) => l.languageTag);

/**
 * Owns the UI language. az is the default. Order of truth (packages/i18n resolve.ts, docs/I18N.md):
 * profile (signed in, explicitly chosen) > locally stored > device language > az.
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const { state, supabase } = useSession();
  const [stored, setStored] = useState<string | null | undefined>(undefined);
  const [locale, setLocaleState] = useState<Locale>(() => resolveLocale({ deviceLocales: deviceLocales() }));
  const reconciledFor = useRef<string | null>(null);

  useEffect(() => {
    void kv.getItem(KEYS.locale).then((v) => {
      setStored(v);
      setLocaleState(resolveLocale({ storedLocale: v, deviceLocales: deviceLocales() }));
    });
  }, []);

  const userId = state.status === "signed-in" ? state.user.id : null;
  const profile = state.status === "signed-in" ? state.profile : null;

  // Reconcile once per signed-in user (cross-device sync): profile wins when explicitly set.
  useEffect(() => {
    if (stored === undefined || !userId || !profile || reconciledFor.current === userId) return;
    reconciledFor.current = userId;
    const r = reconcileLocale({ profile: { locale: profile.locale, localeSetAt: profile.locale_set_at }, storedLocale: stored, deviceLocales: deviceLocales() });
    setLocaleState(r.effective);
    if (r.shouldWriteLocal) void kv.setItem(KEYS.locale, r.effective).catch(() => undefined);
    if (r.shouldWriteProfile && supabase) void supabase.from("profiles").update({ locale: r.effective }).eq("id", userId);
  }, [stored, userId, profile, supabase]);

  useEffect(() => {
    if (!userId) reconciledFor.current = null;
  }, [userId]);

  const setLocale = useCallback(
    async (next: Locale) => {
      const plan = changeLocale(next, userId !== null);
      setLocaleState(next);
      if (plan.shouldWriteLocal) await kv.setItem(KEYS.locale, next).catch(() => undefined);
      if (plan.shouldWriteProfile && userId && supabase) {
        const { error } = await supabase.from("profiles").update({ locale: next }).eq("id", userId);
        if (error) return false;
        await supabase.auth.updateUser({ data: { locale: next } }).catch(() => undefined); // emails read it
      }
      return true;
    },
    [userId, supabase],
  );

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return (
    <LocaleCtx.Provider value={value}>
      <I18nProvider locale={locale} messages={catalogs[locale]}>{children}</I18nProvider>
    </LocaleCtx.Provider>
  );
}

export function useLocaleControl(): Ctx {
  const v = useContext(LocaleCtx);
  if (!v) throw new Error("useLocaleControl outside LocaleProvider");
  return v;
}
