"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LOCALES, LOCALE_COOKIE, LOCALE_NAMES, isLocale } from "@/i18n";
import { useI18n } from "@/i18n/provider";
import { THEME_COOKIE, type ThemePref } from "@/lib/theme";


const YEAR = 60 * 60 * 24 * 365;
export const writeCookie = (name: string, value: string) => {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${YEAR}; SameSite=Lax`;
};

export function LocaleSwitcher({ compact }: { compact?: boolean }) {
  const { locale, t } = useI18n();
  const router = useRouter();
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
          if (!isLocale(e.target.value)) return;
          writeCookie(LOCALE_COOKIE, e.target.value);
          document.documentElement.lang = e.target.value;
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
