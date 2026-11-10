"use client";

import { Icon, OfflineBanner, Avatar, useOnlineStatus, type IconName } from "@unimate/ui";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useI18n } from "@unimate/i18n/react";
import { clearSchedule } from "@/features/planner/offline-cache";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useUser } from "./user";
import { AppLogo } from "./brand";
import { NotificationBell } from "@/features/gamification/NotificationBell";
import { LocaleSwitcher } from "./prefs";

const NAV = [
  { href: "/dashboard", key: "nav.dashboard", icon: "home", mobile: true },
  { href: "/documents", key: "nav.documents", icon: "ai-study", mobile: true },
  { href: "/notes", key: "brand.module.notes", icon: "notes", mobile: false },
  { href: "/career", key: "brand.module.career", icon: "career", mobile: false },
  { href: "/flashcards", key: "nav.flashcards", icon: "flashcard", mobile: false },
  { href: "/planner", key: "nav.planner", icon: "planner", mobile: true },
  { href: "/gamification", key: "brand.module.gamification", icon: "gamification", mobile: false },
  { href: "/focus", key: "nav.focus", icon: "pomodoro", mobile: true },
  { href: "/gpa", key: "nav.gpa", icon: "gpa", mobile: false },
  { href: "/settings", key: "nav.settings", icon: "settings", mobile: true },
] as const satisfies ReadonlyArray<{ href: string; key: string; icon: IconName; mobile: boolean }>;

export function AppShell({ displayName, children }: { displayName: string | null; children: ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const online = useOnlineStatus();
  const user = useUser();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  async function signOut() {
    await clearSchedule(user.id); // do not leave one user's schedule on a shared device
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
        <Link href="/dashboard" className="brand">
          <AppLogo kind="logo" variant="dark" layout="row" height={36} />
        </Link>
        <nav aria-label={t("nav.main")} className="sidebar__nav">
          {NAV.map(({ href, key, icon }) => (
            <Link key={href} href={href} className="navlink" aria-current={isActive(href) ? "page" : undefined}>
              <Icon name={icon} size={22} />
              <span>{t(key)}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar__foot">
          <div className="sidebar__user">
            <Avatar name={displayName} size={34} />
            <span className="sidebar__name">{displayName ?? ""}</span>
            <NotificationBell />
          </div>
          <LocaleSwitcher compact />
          <button type="button" className="navlink navlink--button" onClick={signOut}>
            <Icon name="sign-out" size={22} />
            <span>{t("nav.signOut")}</span>
          </button>
        </div>
      </aside>
      <div className="shell__main">
        <header className="mobilebar">
          <Link href="/dashboard" className="brand">
            <AppLogo kind="logo" variant="dark" layout="row" height={30} />
          </Link>
          <NotificationBell />
        </header>
        <OfflineBanner online={online} message={t("common.offline")} />
        <main id="main" className="page" tabIndex={-1}>
          {children}
        </main>
      </div>
      <nav className="tabbar" aria-label={t("nav.main")}>
        {NAV.filter((n) => n.mobile).map(({ href, key, icon }) => (
          <Link key={href} href={href} className="tabbar__item" aria-current={isActive(href) ? "page" : undefined}>
            <Icon name={icon} />
            <span>{t(key)}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
