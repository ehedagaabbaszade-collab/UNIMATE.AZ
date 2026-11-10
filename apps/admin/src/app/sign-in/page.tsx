import { BackendNotConfigured } from "../../components/BackendNotConfigured";
import { AppLogo } from "../../components/brand";
import { LocaleSwitcher } from "../../components/prefs";
import { SignInForm } from "../../features/auth/SignInForm";
import { getT } from "../../i18n/server";
import { getSupabaseEnv } from "../../lib/supabase/env";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (!getSupabaseEnv()) return <BackendNotConfigured />;
  const sp = await searchParams;
  const { t } = await getT();
  return (
    <div className="auth">
      <aside className="auth__aside" aria-hidden="true">
        <h2>{t("admin.title")}</h2>
        <p>{t("admin.mfaNote")}</p>
      </aside>
      <main className="auth__main" id="main">
        <div className="auth__card">
          <div className="auth__top">
            <AppLogo kind="logo" height={84} />
            <LocaleSwitcher compact />
          </div>
          <SignInForm {...(sp.next ? { next: sp.next } : {})} />
        </div>
      </main>
    </div>
  );
}
