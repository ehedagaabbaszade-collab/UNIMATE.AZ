"use client";

import { OfflineBanner, Avatar, useOnlineStatus } from "@unimate/ui";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useI18n } from "@/i18n/provider";
import { clearSchedule } from "@/features/planner/offline-cache";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useUser } from "./user";
import { CardsIcon, DocsIcon, FocusIcon, GpaIcon, HomeIcon, LogoMark, PlannerIcon, SettingsIcon, SignOutIcon } from "./icons";
import { LocaleSwitcher } from "./prefs";

const NAV = [
  { href: "/dashboard", key: "nav.dashboard", icon: HomeIcon, mobile: true },
  { href: "/documents", key: "nav.documents", icon: DocsIcon, mobile: true },
  { href: "/flashcards", key: "nav.flashcards", icon: CardsIcon, mobile: false },
  { href: "/planner", key: "nav.planner", icon: PlannerIcon, mobile: true },
  { href: "/focus", key: "nav.focus", icon: FocusIcon, mobile: true },
  { href: "/gpa", key: "nav.gpa", icon: GpaIcon, mobile: false },
  { href: "/settings", key: "nav.settings", icon: SettingsIcon, mobile: true },
] as const;

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
          <LogoMark />
          <span>UNIMATE</span>
        </Link>
        <nav aria-label={t("nav.main")} className="sidebar__nav">
          {NAV.map(({ href, key, icon: Icon }) => (
            <Link key={href} href={href} className="navlink" aria-current={isActive(href) ? "page" : undefined}>
              <Icon />
              <span>{t(key)}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar__foot">
          <div className="sidebar__user">
            <Avatar name={displayName} size={34} />
            <span className="sidebar__name">{displayName ?? ""}</span>
          </div>
          <LocaleSwitcher compact />
          <button type="button" className="navlink navlink--button" onClick={signOut}>
            <SignOutIcon />
            <span>{t("nav.signOut")}</span>
          </button>
        </div>
      </aside>
      <div className="shell__main">
        <OfflineBanner online={online} message={t("common.offline")} />
        <main id="main" className="page" tabIndex={-1}>
          {children}
        </main>
      </div>
      <nav className="tabbar" aria-label={t("nav.main")}>
        {NAV.filter((n) => n.mobile).map(({ href, key, icon: Icon }) => (
          <Link key={href} href={href} className="tabbar__item" aria-current={isActive(href) ? "page" : undefined}>
            <Icon />
            <span>{t(key)}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
