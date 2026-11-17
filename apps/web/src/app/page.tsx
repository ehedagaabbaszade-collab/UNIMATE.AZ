import { ErrorState, Icon, type IconName } from "@unimate/ui";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { CSSProperties } from "react";
import { AppLogo } from "@/components/brand";
import { LocaleSwitcher, ThemeSwitch } from "@/components/prefs";
import { body, head } from "@/app/fonts";
import { getT } from "@/i18n/server";
import { MODE_COOKIE, homeFor, parseMode } from "@/lib/mode";
import { getServerClient } from "@/lib/supabase/server";


const MODULES = [
  ["ai", "ai-study"],
  ["planner", "planner"],
  ["cards", "flashcard"],
  ["notes", "notes"],
  ["campus", "campus"],
  ["career", "career"],
  ["gpa", "gpa"],
  ["focus", "pomodoro"],
  ["budget", "wallet"],
  ["colleges", "institution"],
  ["classes", "group"],
] as const satisfies readonly (readonly [string, IconName])[];
const ORBIT = ["planner", "flashcard", "notes", "campus", "career", "gpa"] as const satisfies readonly IconName[];
const TEACHER_ITEMS = ["t1", "t2", "t3", "t4", "t5", "t6", "t7"] as const;
const STEPS = ["s1", "s2", "s3"] as const;
const FAQ = ["q1", "q2", "q3", "q4", "q5"] as const;

const Spark = () => <span className="lp-spark" aria-hidden="true" />;

function Mock({ t }: { t: Awaited<ReturnType<typeof getT>>["t"] }) {
  const side = [
    ["main", t("landing.mock.main")],
    ["planner", t("landing.modules.items.planner.title")],
    ["ai", t("landing.modules.items.ai.title")],
    ["cards", t("landing.modules.items.cards.title")],
    ["campus", t("landing.modules.items.campus.title")],
  ] as const;
  return (
    <div className="lp-app" aria-hidden="true">
      <div className="lp-app__side">
        <div className="lp-app__dots"><i /><i /><i /></div>
        {side.map(([k, label]) => (
          <span key={k} className="lp-app__item" data-on={k === "ai" ? "" : undefined}>{label}</span>
        ))}
      </div>
      <div className="lp-app__main">
        <span className="lp-orb" />
        <strong>{t("landing.mock.hello")}</strong>
        <span className="lp-app__input">{t("landing.mock.input")}</span>
      </div>
    </div>
  );
}

export default async function Landing() {
  const { t } = await getT();
  const supabase = await getServerClient();
  if (supabase) {
    const { data } = await supabase.auth.getUser();
    if (data.user) redirect(homeFor(parseMode((await cookies()).get(MODE_COOKIE)?.value)));
  }
  const ctas = supabase ? (
    <div className="lp-cta">
      <Link className="lp-btn lp-btn--white" href="/sign-up">{t("landing.hero.ctaStudent")}</Link>
      <Link className="lp-btn lp-btn--glow" href="/sign-up?as=teacher">{t("landing.hero.ctaTeacher")}</Link>
    </div>
  ) : null;
  return (
    <div className={`lp ${head.variable} ${body.className}`}>
      <header className="lp-bar">
        <div className="lp-bar__in">
          <Link href="/" className="lp-bar__brand">
            <AppLogo kind="logo" layout="row" height={26} />
          </Link>
          <nav className="lp-bar__links" aria-label={t("landing.nav.aria")}>
            <a href="#features">{t("landing.nav.features")}</a>
            <a href="#teachers">{t("landing.nav.teachers")}</a>
            <a href="#faq">{t("landing.nav.faq")}</a>
          </nav>
          <div className="lp-bar__actions">
            <div className="lp-bar__locale"><LocaleSwitcher compact /></div>
            <ThemeSwitch />
            {supabase ? (
              <>
                <Link className="lp-bar__signin" href="/sign-in">{t("auth.signInCta")}</Link>
                <Link className="lp-btn lp-btn--glow lp-btn--sm" href="/sign-up">{t("landing.nav.signUp")}</Link>
              </>
            ) : null}
          </div>
        </div>
      </header>
      <main id="main">
        {!supabase ? (
          <div className="lp-wrap lp-section">
            <ErrorState title={t("backend.title")} description={t("backend.body")} />
          </div>
        ) : null}
        <section className="lp-hero lp-dots">
          <div className="lp-wrap lp-hero__copy">
            <h1 className="lp-title">
              <span className="lp-fade">{t("landing.hero.l1")}</span>
              <span className="lp-fade">{t("landing.hero.l2")}</span>
              <span className="lp-title__last"><Spark />{t("landing.hero.l3")}<span className="lp-orb lp-orb--sm" aria-hidden="true" /></span>
            </h1>
            <p className="lp-lead">{t("landing.hero.lead")}</p>
            {ctas}
            {supabase ? <Link className="lp-link" href="/sign-in">{t("landing.haveAccount")}</Link> : null}
          </div>
          <div className="lp-wrap">
            <div className="lp-panel lp-glow" role="img" aria-label={t("landing.preview.sample")}>
              <Mock t={t} />
            </div>
          </div>
        </section>

        <section className="lp-marquee" aria-label={t("landing.marquee.title")}>
          <p className="lp-marquee__title">{t("landing.marquee.title")}</p>
          <div className="lp-marquee__track" aria-hidden="true">
            {[0, 1].map((n) => (
              <ul key={n} className="lp-marquee__row">
                {MODULES.map(([k, icon]) => (
                  <li key={k}><Icon name={icon} size={18} />{t(`landing.modules.items.${k}.title`)}</li>
                ))}
              </ul>
            ))}
          </div>
        </section>

        <section id="features" className="lp-section">
          <div className="lp-wrap">
            <div className="lp-head">
              <h2 className="lp-h2">{t("landing.modules.title")}</h2>
              <p className="lp-sub">{t("landing.modules.body")}</p>
            </div>
            <div className="lp-bento">
              <article className="lp-card lp-card--top">
                <div className="lp-ill lp-ill--orbit" aria-hidden="true">
                  <span className="lp-orbit__core"><AppLogo kind="mark" height={30} /></span>
                  {ORBIT.map((icon, i) => (
                    <span key={icon} className="lp-orbit__dot" style={{ "--a": `${i * 60}deg` } as CSSProperties}>
                      <Icon name={icon} size={16} />
                    </span>
                  ))}
                </div>
                <h3>{t("landing.bento.hub.title")}</h3>
                <p>{t("landing.bento.hub.body")}</p>
              </article>
              <article className="lp-card lp-card--top">
                <div className="lp-ill lp-ill--chat" aria-hidden="true">
                  <span className="lp-bubble lp-bubble--q">{t("landing.bento.ai.q")}</span>
                  <span className="lp-bubble lp-bubble--a">{t("landing.bento.ai.a")}</span>
                </div>
                <h3>{t("landing.bento.ai.title")}</h3>
                <p>{t("landing.bento.ai.body")}</p>
              </article>
              <article className="lp-card lp-card--top">
                <div className="lp-ill lp-ill--list" aria-hidden="true">
                  {(["r1", "r2", "r3"] as const).map((r, i) => (
                    <span key={r} className="lp-check" data-done={i === 0 ? "" : undefined}>
                      <i />{t(`landing.preview.${r}`)}
                    </span>
                  ))}
                </div>
                <h3>{t("landing.bento.plan.title")}</h3>
                <p>{t("landing.bento.plan.body")}</p>
              </article>
            </div>
            <ul className="lp-grid">
              {MODULES.map(([k, icon]) => (
                <li key={k} className="lp-card">
                  <span className="lp-card__icon"><Icon name={icon} size={20} /></span>
                  <h3>{t(`landing.modules.items.${k}.title`)}</h3>
                  <p>{t(`landing.modules.items.${k}.body`)}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="teachers" className="lp-section">
          <div className="lp-wrap lp-teach">
            <div>
              <p className="lp-eyebrow">{t("landing.teachers.eyebrow")}</p>
              <h2 className="lp-h2">{t("landing.teachers.title")}</h2>
              <p className="lp-sub">{t("landing.teachers.body")}</p>
              {supabase ? (
                <Link className="lp-btn lp-btn--glow" href="/sign-in?as=teacher">{t("landing.teachers.cta")}</Link>
              ) : null}
            </div>
            <ul className="lp-list">
              {TEACHER_ITEMS.map((k) => (
                <li key={k} className="lp-card lp-card--top">
                  <strong>{t(`landing.teachers.items.${k}.title`)}</strong>
                  <span>{t(`landing.teachers.items.${k}.body`)}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="faq" className="lp-section">
          <div className="lp-wrap">
            <div className="lp-panel lp-glow lp-faqpanel">
              <div className="lp-faq">
                <h2 className="lp-h2">{t("landing.faq.title")}</h2>
                {FAQ.map((q) => (
                  <details key={q}>
                    <summary>
                      <span className="lp-q" aria-hidden="true">?</span>
                      <span className="lp-qtext">{t(`landing.faq.items.${q}.q`)}</span>
                    </summary>
                    <p>{t(`landing.faq.items.${q}.a`)}</p>
                  </details>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="how" className="lp-section">
          <div className="lp-wrap">
            <div className="lp-head">
              <p className="lp-eyebrow">{t("landing.how.eyebrow")}</p>
              <h2 className="lp-h2">{t("landing.how.title")}</h2>
            </div>
            <ol className="lp-steps">
              {STEPS.map((s, i) => (
                <li key={s} className="lp-card lp-card--top">
                  <span className="lp-num" aria-hidden="true">{i + 1}</span>
                  <h3>{t(`landing.how.steps.${s}.title`)}</h3>
                  <p>{t(`landing.how.steps.${s}.body`)}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {supabase ? (
          <section className="lp-section">
            <div className="lp-wrap">
              <div className="lp-cardcta">
                <div className="lp-cardcta__copy">
                  <h2 className="lp-h2">{t("landing.cardCta.title")}</h2>
                  {ctas}
                </div>
                <div className="lp-cardcta__art" aria-hidden="true">
                  <div className="lp-tilt lp-tilt--a"><Mock t={t} /></div>
                  <div className="lp-tilt lp-tilt--b"><Mock t={t} /></div>
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </main>
      <footer className="lp-foot">
        <div className="lp-wrap">
          <div className="lp-foot__top">
            <div className="lp-foot__about">
              <AppLogo kind="logo" layout="row" height={28} />
              <strong>{t("landing.foot.tagline")}</strong>
              <p>{t("landing.foot.text")}</p>
              <LocaleSwitcher compact id="locale-select-foot" />
            </div>
            <nav className="lp-foot__col" aria-label={t("landing.foot.menu")}>
              <h3>{t("landing.foot.menu")}</h3>
              <a href="#features">{t("landing.nav.features")}</a>
              <a href="#teachers">{t("landing.nav.teachers")}</a>
              <a href="#faq">{t("landing.nav.faq")}</a>
            </nav>
            <nav className="lp-foot__col" aria-label={t("landing.foot.legal")}>
              <h3>{t("landing.foot.legal")}</h3>
              <Link href="/legal/privacy">{t("legal.privacy")}</Link>
              <Link href="/legal/terms">{t("legal.terms")}</Link>
            </nav>
          </div>
          {supabase ? (
            <nav className="lp-foot__links" aria-label={t("landing.nav.aria")}>
              <Link href="/sign-in">{t("auth.signInCta")} <span aria-hidden="true">&rarr;</span></Link>
              <Link href="/sign-up">{t("landing.nav.signUp")} <span aria-hidden="true">&rarr;</span></Link>
              <Link href="/sign-in?as=teacher">{t("landing.teachers.cta")} <span aria-hidden="true">&rarr;</span></Link>
              <Link href="/legal/privacy">{t("legal.privacy")} <span aria-hidden="true">&rarr;</span></Link>
            </nav>
          ) : null}
          <p className="lp-foot__word" aria-hidden="true">UNIMATE</p>
          <div className="lp-foot__bottom">
            <span>{t("landing.copyright")}</span>
            <span className="lp-foot__legal">
              <Link href="/legal/privacy">{t("legal.privacy")}</Link>
              <Link href="/legal/terms">{t("legal.terms")}</Link>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
