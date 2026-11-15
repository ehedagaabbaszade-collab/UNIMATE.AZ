"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@unimate/ui";
import { LOCALES, LOCALE_NAMES, isLocale } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import { persistLocale } from "@/i18n/client";
import { useOptionalUser } from "@/components/user";
import { writeCookie } from "@/lib/cookies";
import { THEME_COOKIE, type ThemePref } from "@/lib/theme";

export function LocaleSwitcher({ compact }: { compact?: boolean }) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const user = useOptionalUser();
  const { toast } = useToast();
  return (
    <div className="um-field" style={compact ? { gap: 4 } : undefined}>
      <label className={compact ? "um-sr-only" : "um-label"} htmlFor="locale-select">
        {t("language.label")}
      </label>
      <select
        id="locale-select"
        className="um-input"
        style={compact ? { minHeight: 36, padding: "4px 8px" } : undefined}
        value={locale}
        onChange={(e) => {
          const next = e.target.value;
          if (!isLocale(next)) return;
          // The local copy changes first so the UI switches at once; the profile write follows when signed in.
          void persistLocale(next, user?.id ?? null).then((ok) => {
            if (!ok) toast(t("language.saveFailed"), "error");
          });
          router.refresh();
        }}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ThemeToggle({ initial }: { initial: ThemePref }) {
  const { t } = useI18n();
  const [value, setValue] = useState<ThemePref>(initial);
  const apply = (v: ThemePref) => {
    setValue(v);
    writeCookie(THEME_COOKIE, v);
    if (v === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", v);
  };
  const options: ThemePref[] = ["system", "light", "dark"];
  return (
    <fieldset className="seg" aria-label={t("theme.label")}>
      <legend className="um-label">{t("theme.label")}</legend>
      <div className="seg__row">
        {options.map((o) => (
          <label key={o} className="seg__item">
            <input type="radio" name="theme" value={o} checked={value === o} onChange={() => apply(o)} className="um-sr-only" />
            <span>{t(`theme.${o}`)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
