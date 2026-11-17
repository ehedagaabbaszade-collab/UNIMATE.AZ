import Link from "next/link";
import type { ReactNode } from "react";
import { BackendNotConfigured } from "@/components/BackendNotConfigured";
import { AppLogo } from "@/components/brand";
import { LocaleSwitcher, ThemeSwitch } from "@/components/prefs";
import { body, head } from "@/app/fonts";
import { getT } from "@/i18n/server";
import { getSupabaseEnv } from "@/lib/supabase/env";


export default async function AuthLayout({ children }: { children: ReactNode }) {
  if (!getSupabaseEnv()) return <BackendNotConfigured />;
  const { t } = await getT();
  return (
    <div className={`auth ${head.variable} ${body.className}`}>
      <aside className="auth__aside" aria-hidden="true">
        <h2>{t("landing.title")}</h2>
        <p>{t("landing.f1Body")}</p>
      </aside>
      <main className="auth__main" id="main">
        <div className="auth__card">
          <Link href="/" className="auth__back">
            <span aria-hidden="true">←</span> {t("auth.backHome")}
          </Link>
          <div className="auth__top">
            <Link href="/" className="auth__brand">
              <AppLogo kind="logo" height={84} />
            </Link>
            <div className="row" style={{ flexWrap: "nowrap", gap: 8 }}>
              <LocaleSwitcher compact />
              <ThemeSwitch />
            </div>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
