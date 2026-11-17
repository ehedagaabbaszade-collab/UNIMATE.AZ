"use client";

import { Icon, OfflineBanner, Avatar, useOnlineStatus } from "@unimate/ui";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@unimate/i18n/react";
import { body, head } from "@/app/fonts";
import { useSignOut } from "./sign-out";
import { AppLogo } from "./brand";
import { NotificationBell, useUnreadCount } from "@/features/gamification/NotificationBell";
import { LocaleSwitcher } from "./prefs";
import { CommandPalette, usePaletteShortcut } from "./CommandPalette";
import { homeFor, setModeCookie, type AppMode } from "@/lib/mode";
import { NAV_GROUPS, SETTINGS_ITEM, TAB_ITEMS, TEACHER_NAV_GROUPS, TEACHER_TAB_ITEMS, isActive } from "./nav";

export function AppShell({ displayName, mode, children }: { displayName: string | null; mode: AppMode; children: ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const online = useOnlineStatus();
  const unread = useUnreadCount();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const togglePalette = useCallback(() => setPaletteOpen((o) => !o), []);
  usePaletteShortcut(togglePalette);
  const current = (href: string) => (isActive(pathname, href) ? "page" : undefined);

  const groups = mode === "teacher" ? TEACHER_NAV_GROUPS : NAV_GROUPS;
  const tabs = mode === "teacher" ? TEACHER_TAB_ITEMS : TAB_ITEMS;
  const other: AppMode = mode === "teacher" ? "student" : "teacher";

  function switchMode() {
    setModeCookie(other);
    router.push(homeFor(other));
    router.refresh();
  }

  const signOut = useSignOut(mode);

  const [collapsed, setCollapsed] = useState(false);
  const [tip, setTip] = useState<{ text: string; top: number; left: number } | null>(null);
  useEffect(() => {
    try { setCollapsed(localStorage.getItem("um.sidebar.collapsed") === "1"); } catch { /* storage blocked */ }
  }, []);
  function toggleSidebar() {
    setTip(null);
    setCollapsed((c) => {
      try { localStorage.setItem("um.sidebar.collapsed", c ? "0" : "1"); } catch { /* storage blocked */ }
      return !c;
    });
  }
  // Fixed-position tooltip: the nav scroll container would clip an absolutely positioned bubble.
  function showTip(e: React.SyntheticEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".navlink, .sidebar__search, .sidebar__toggle");
    const text = el?.getAttribute("data-tip");
    if (!collapsed || !el || !text) return setTip(null);
    const r = el.getBoundingClientRect();
    setTip({ text, top: r.top + r.height / 2, left: r.right + 10 });
  }

  return (
    <div className={`shell ${collapsed ? "shell--collapsed " : ""}${head.variable} ${body.className}`}>
      <a className="um-skip" href="#main">
        {t("common.skipToContent")}
      </a>
      <aside id="app-sidebar" className="sidebar" onMouseOver={showTip} onMouseLeave={() => setTip(null)} onFocus={showTip} onBlur={() => setTip(null)}>
        <div className="sidebar__top">
          <Link href={homeFor(mode)} className="brand">
            {collapsed ? <AppLogo kind="mark" height={32} /> : <AppLogo kind="logo" layout="row" height={34} />}
          </Link>
          <button
            type="button"
            className="sidebar__toggle"
            onClick={toggleSidebar}
            aria-expanded={!collapsed}
            aria-controls="app-sidebar"
            aria-label={t(collapsed ? "nav.expand" : "nav.collapse")}
            data-tip={t(collapsed ? "nav.expand" : "nav.collapse")}
          >
            <Icon name="chevron-left" size={18} />
          </button>
        </div>
        <button type="button" className="sidebar__search" onClick={() => setPaletteOpen(true)} data-tip={t("palette.open")} aria-label={t("palette.open")}>
          <Icon name="search" size={18} />
          <span>{t("palette.open")}</span>
          <kbd aria-hidden="true">{"Ctrl K"}</kbd>
        </button>
        <nav aria-label={t("nav.main")} className="sidebar__nav">
          {groups.map((g) => (
            <div key={g.id} className="sidebar__group" role="group" aria-label={g.label ? t(g.label) : undefined}>
              {g.label ? <p className="sidebar__label" aria-hidden="true">{t(g.label)}</p> : null}
              {g.items.map(({ href, key, icon }) => (
                <Link key={href} href={href} className="navlink" aria-current={current(href)} data-tip={t(key)}>
                  <Icon name={icon} size={20} />
                  <span>{t(key)}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar__foot">
          <Link href={SETTINGS_ITEM.href} className="navlink" aria-current={current(SETTINGS_ITEM.href)} data-tip={t(SETTINGS_ITEM.key)}>
            <Icon name={SETTINGS_ITEM.icon} size={20} />
            <span>{t(SETTINGS_ITEM.key)}</span>
          </Link>
          <Link href="/?site=1" className="navlink" data-tip={t("nav.publicSite")}>
            <Icon name="home" size={20} />
            <span>{t("nav.publicSite")}</span>
          </Link>
          <button type="button" className="navlink navlink--button" onClick={switchMode} data-tip={t(`landing.switchTo.${other}`)}>
            <Icon name="group" size={20} />
            <span>{t(`landing.switchTo.${other}`)}</span>
          </button>
          <button type="button" className="navlink navlink--button" onClick={signOut} data-tip={t("nav.signOut")}>
            <Icon name="sign-out" size={20} />
            <span>{t("nav.signOut")}</span>
          </button>
          <div className="sidebar__user">
            <Avatar name={displayName} size={32} />
            <span className="sidebar__name">{displayName ?? ""}</span>
            <NotificationBell unread={unread} />
          </div>
          <LocaleSwitcher compact />
        </div>
        {tip ? <div className="sidebar__tip" role="presentation" style={{ top: tip.top, left: tip.left }}>{tip.text}</div> : null}
      </aside>
      <div className="shell__main">
        <header className="mobilebar">
          <Link href={homeFor(mode)} className="brand">
            <AppLogo kind="logo" layout="row" height={30} />
          </Link>
          <div className="mobilebar__actions">
            <button type="button" className="iconbtn" onClick={() => setPaletteOpen(true)} aria-label={t("palette.open")}>
              <Icon name="search" size={22} />
            </button>
            <NotificationBell unread={unread} />
            <Link href="/profile" className="iconbtn" aria-label={t("brand.module.profile")}>
              <Avatar name={displayName} size={28} />
            </Link>
          </div>
        </header>
        <OfflineBanner online={online} message={t("common.offline")} />
        <main id="main" className="page" tabIndex={-1}>
          {children}
        </main>
      </div>
      <nav className="tabbar" aria-label={t("nav.main")}>
        {tabs.map(({ href, key, icon }) => (
          <Link key={href} href={href} className="tabbar__item" aria-current={current(href)}>
            <Icon name={icon} />
            <span>{t(key)}</span>
          </Link>
        ))}
        <button type="button" className="tabbar__item tabbar__more" onClick={() => setPaletteOpen(true)} aria-haspopup="dialog">
          <Icon name="more" />
          <span>{t("nav.more")}</span>
        </button>
      </nav>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
