"use client";

import { Avatar, Badge, Icon } from "@unimate/ui";
import { useI18n } from "@unimate/i18n/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { navFor } from "../lib/guard";
import { getBrowserClient } from "../lib/supabase/browser";
import type { ThemePref } from "../lib/theme";
import { AppLogo } from "./brand";
import { LocaleSwitcher, ThemeToggle } from "./prefs";
import { useStaff } from "./staff";

export function AdminShell({ theme, children }: { theme: ThemePref; children: ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const user = useStaff();
  const items = navFor(user.role);
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));
  const name = user.displayName ?? user.email;

  async function signOut() {
    await getBrowserClient().auth.signOut();
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <div className="shell">
      <a className="um-skip" href="#main">
        {t("common.skipToContent")}
      </a>
      <aside className="sidebar">
        <Link href="/" className="brand">
          <AppLogo kind="logo" variant="dark" layout="row" height={36} />
        </Link>
        <nav aria-label={t("admin.nav.main")} className="sidebar__nav">
          {items.map(({ href, key, icon }) => (
            <Link key={href} href={href} className="navlink" aria-current={isActive(href) ? "page" : undefined}>
              <Icon name={icon} size={22} />
              <span>{t(key)}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar__foot">
          <div className="sidebar__user">
            <Avatar name={name} size={34} />
            <span className="sidebar__name">{name ?? ""}</span>
          </div>
          <Badge tone="primary" style={{ justifySelf: "start", marginLeft: "var(--space-3)" }}>
            {t(`admin.role.${user.role}`)}
          </Badge>
          <LocaleSwitcher compact />
          <button type="button" className="navlink navlink--button" onClick={signOut}>
            <Icon name="sign-out" size={22} />
            <span>{t("admin.nav.signOut")}</span>
          </button>
        </div>
      </aside>
      <div className="shell__main">
        <header className="mobilebar">
          <Link href="/" className="brand">
            <AppLogo kind="logo" variant="dark" layout="row" height={30} />
          </Link>
          <div className="mobilebar__tools">
            <LocaleSwitcher compact />
            <button type="button" className="navlink navlink--button" style={{ display: "inline-flex", width: "auto", color: "#fff", minHeight: 44 }} onClick={signOut} aria-label={t("admin.nav.signOut")}>
              <Icon name="sign-out" size={22} />
            </button>
          </div>
        </header>
        <nav className="mobilenav" aria-label={t("admin.nav.main")}>
          {items.map(({ href, key, icon }) => (
            <Link key={href} href={href} aria-current={isActive(href) ? "page" : undefined}>
              <Icon name={icon} size={20} />
              <span>{t(key)}</span>
            </Link>
          ))}
        </nav>
        <main id="main" className="page" tabIndex={-1}>
          {children}
          <div style={{ marginTop: "var(--space-7)" }}>
            <ThemeToggle initial={theme} />
          </div>
        </main>
      </div>
    </div>
  );
}
