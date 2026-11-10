import Link from "next/link";
import { notFound } from "next/navigation";
import { LEGAL_SLUGS, legal, type LegalSlug } from "@/content/legal";
import { LogoMark } from "@/components/icons";
import { LocaleSwitcher } from "@/components/prefs";
import { getT } from "@/i18n/server";

const NAV_KEYS: Record<LegalSlug, "privacy" | "terms" | "aiDisclaimer" | "community" | "retention"> = {
  privacy: "privacy",
  terms: "terms",
  "ai-disclaimer": "aiDisclaimer",
  "community-guidelines": "community",
  "data-retention": "retention",
};

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(LEGAL_SLUGS as readonly string[]).includes(slug)) notFound();
  const { t, locale } = await getT();
  const doc = legal[locale][slug as LegalSlug];

  return (
    <>
      <header className="topbar">
        <Link href="/" className="auth__brand">
          <LogoMark />
          UNIMATE
        </Link>
        <LocaleSwitcher compact />
      </header>
      <main id="main" className="page">
        <div className="prose">
          <nav className="legal-nav" aria-label={t("legal.title")}>
            {LEGAL_SLUGS.map((s) => (
              <Link key={s} href={`/legal/${s}`} aria-current={s === slug ? "page" : undefined}>
                {t(`legal.${NAV_KEYS[s]}`)}
              </Link>
            ))}
          </nav>
          <p className="draft-banner" role="note">{t("legal.draftBanner")}</p>
          <h1>{doc.title}</h1>
          <p className="um-muted">{t("legal.lastUpdated")}</p>
          {doc.sections.map((s) => (
            <section key={s.h}>
              <h2>{s.h}</h2>
              {s.p?.map((p, i) => <p key={i}>{p}</p>)}
              {s.ul ? <ul>{s.ul.map((li, i) => <li key={i}>{li}</li>)}</ul> : null}
            </section>
          ))}
        </div>
      </main>
    </>
  );
}
