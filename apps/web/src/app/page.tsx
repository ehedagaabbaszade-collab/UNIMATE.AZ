import { ErrorState } from "@unimate/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LocaleSwitcher } from "@/components/prefs";
import { LogoMark } from "@/components/icons";
import { getT } from "@/i18n/server";
import { getServerClient } from "@/lib/supabase/server";

export default async function Landing() {
  const { t } = await getT();
  const supabase = await getServerClient();
  if (supabase) {
    const { data } = await supabase.auth.getUser();
    if (data.user) redirect("/dashboard");
  }
  return (
    <>
      <header className="topbar">
        <span className="auth__brand">
          <LogoMark />
          UNIMATE
        </span>
        <div className="row">
          <LocaleSwitcher compact />
          {supabase ? (
            <Link className="um-btn um-btn--ghost um-btn--sm" href="/sign-in">
              {t("auth.signInCta")}
            </Link>
          ) : null}
        </div>
      </header>
      <main id="main">
        {!supabase ? (
          <div className="hero">
            <ErrorState title={t("backend.title")} description={t("backend.body")} />
          </div>
        ) : null}
        <section className="hero">
          <p className="eyebrow">{t("landing.eyebrow")}</p>
          <h1>{t("landing.title")}</h1>
          <p className="hero__lead">{t("landing.body")}</p>
          {supabase ? (
            <div className="row">
              <Link className="um-btn" href="/sign-up">
                {t("landing.cta")}
              </Link>
              <Link className="um-btn um-btn--secondary" href="/sign-in">
                {t("landing.haveAccount")}
              </Link>
            </div>
          ) : null}
        </section>
        <section className="features" aria-label={t("common.appName")}>
          {(["f1", "f2", "f3"] as const).map((f) => (
            <div key={f} className="um-card">
              <h3>{t(`landing.${f}Title`)}</h3>
              <p className="um-muted" style={{ marginTop: "var(--space-2)" }}>
                {t(`landing.${f}Body`)}
              </p>
            </div>
          ))}
        </section>
      </main>
      <footer className="topbar um-muted" style={{ fontSize: "var(--text-sm)" }}>
        <span>© UNIMATE</span>
        <nav className="legal-nav" aria-label={t("legal.title")}>
          <Link href="/legal/privacy">{t("legal.privacy")}</Link>
          <Link href="/legal/terms">{t("legal.terms")}</Link>
        </nav>
      </footer>
    </>
  );
}
