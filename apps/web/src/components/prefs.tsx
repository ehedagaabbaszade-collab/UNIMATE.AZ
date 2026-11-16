"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon, useToast } from "@unimate/ui";
import { LOCALES, LOCALE_NAMES, isLocale } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import { persistLocale } from "@/i18n/client";
import { useOptionalUser } from "@/components/user";
import { writeCookie } from "@/lib/cookies";
import { THEME_COOKIE, type ThemePref } from "@/lib/theme";

export function LocaleSwitcher({ compact, id = "locale-select" }: { compact?: boolean; id?: string }) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const user = useOptionalUser();
  const { toast } = useToast();
  return (
    <div className="um-field" style={compact ? { gap: 4 } : undefined}>
      <label className={compact ? "um-sr-only" : "um-label"} htmlFor={id}>
        {t("language.label")}
      </label>
      {/* The pill shows the short code (AZ, EN…); the real <select> sits invisibly on top, so a click opens the list of
          full language names (styled in select.css) and keyboard / screen-reader use stay native. */}
      <span className={compact ? "locale locale--sm" : "locale"}>
      <Icon name="languages" size={16} aria-hidden="true" />
      <span className="locale__code" aria-hidden="true">{locale.toUpperCase()}</span>
      <select
        id={id}
        className="locale__select"
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
      </span>
    </div>
  );
}

/** One-tap light/dark switch for the public pages. Which icon shows is pure CSS (no hydration mismatch); the colour
 *  change spreads as a circle from the button where View Transitions exist and motion is allowed. */
export function ThemeSwitch() {
  const { t } = useI18n();
  function toggle(e: React.MouseEvent<HTMLButtonElement>) {
    const root = document.documentElement;
    const current = root.getAttribute("data-theme") ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    const apply = () => {
      writeCookie(THEME_COOKIE, next);
      root.setAttribute("data-theme", next);
    };
    const r = e.currentTarget.getBoundingClientRect();
    root.style.setProperty("--vt-x", `${r.left + r.width / 2}px`);
    root.style.setProperty("--vt-y", `${r.top + r.height / 2}px`);
    const vt = (document as Document & { startViewTransition?: (cb: () => void) => unknown }).startViewTransition;
    if (vt && !matchMedia("(prefers-reduced-motion: reduce)").matches) vt.call(document, apply);
    else apply();
  }
  return (
    <button type="button" className="theme-switch" onClick={toggle} aria-label={t("theme.label")} title={t("theme.label")}>
      <Icon name="sun" size={18} className="theme-switch__sun" aria-hidden="true" />
      <Icon name="moon" size={18} className="theme-switch__moon" aria-hidden="true" />
    </button>
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
