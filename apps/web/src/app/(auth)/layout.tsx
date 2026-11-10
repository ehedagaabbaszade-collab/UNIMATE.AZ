import Link from "next/link";
import type { ReactNode } from "react";
import { BackendNotConfigured } from "@/components/BackendNotConfigured";
import { AppLogo } from "@/components/brand";
import { LocaleSwitcher } from "@/components/prefs";
import { getT } from "@/i18n/server";
import { getSupabaseEnv } from "@/lib/supabase/env";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  if (!getSupabaseEnv()) return <BackendNotConfigured />;
  const { t } = await getT();
  return (
    <div className="auth">
      <aside className="auth__aside" aria-hidden="true">
        <h2>{t("landing.title")}</h2>
        <p>{t("landing.f1Body")}</p>
      </aside>
      <main className="auth__main" id="main">
        <div className="auth__card">
          <div className="auth__top">
            <Link href="/" className="auth__brand">
              <AppLogo kind="logo" height={84} />
            </Link>
            <LocaleSwitcher compact />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
