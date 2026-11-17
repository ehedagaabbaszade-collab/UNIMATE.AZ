"use client";

import { parseMyProgress } from "@unimate/core";
import { Badge, EmptyState, ErrorState, Icon, ProgressRing, Skeleton } from "@unimate/ui";
import Link from "next/link";
import { useUser } from "@/components/user";
import { ACTIONS } from "@/components/nav";
import { useI18n } from "@unimate/i18n/react";
import type { DocumentRow } from "@/lib/db";
import { getBrowserClient } from "@/lib/supabase/browser";
import { unwrap, useAsync } from "@/lib/use-async";
import { STATUS_TONE } from "../documents/DocumentsList";
import { classesOn, hhmm } from "../planner/schedule";
import { useSchedule } from "../planner/useSchedule";
import { buildAgenda, type AgendaItem } from "./agenda";

/** Quick actions shown on the dashboard (the palette has the full list). */
const QUICK = ACTIONS.filter((a) => ["palette.uploadDoc", "palette.addTask", "palette.startFocus", "palette.reviewCards"].includes(a.key));

function AgendaRow({ item }: { item: AgendaItem }) {
  const { t, dateTime } = useI18n();
  const title = item.kind === "cards" ? t("dashboard.agenda.cards", { n: item.count }) : item.title;
  const meta =
    item.kind === "overdue"
      ? t("dashboard.agenda.overdue", { date: dateTime(item.at) })
      : item.kind === "dueSoon"
        ? t("dashboard.agenda.due", { date: dateTime(item.at) })
        : item.kind === "exam"
          ? t("dashboard.agenda.examIn", { n: item.days })
          : t("dashboard.agenda.cardsBody");
  const cta = item.kind === "cards" || (item.kind === "exam" && item.href === "/flashcards") ? t("dashboard.agenda.revise") : t("dashboard.agenda.open");
  return (
    <li className={`agenda__row agenda__row--${item.kind}`}>
      <span className="agenda__icon" aria-hidden="true">
        <Icon name={item.kind === "exam" ? "exams" : item.kind === "cards" ? "flashcard" : "tasks"} size={20} />
      </span>
      <div className="agenda__text">
        <span className="agenda__title">{title}</span>
        <span className="agenda__meta">{meta}</span>
      </div>
      <Link className="um-btn um-btn--secondary um-btn--sm" href={item.href} aria-label={`${cta}: ${title}`}>
        {cta}
      </Link>
    </li>
  );
}

export function Dashboard() {
  const { t, date, number, percent } = useI18n();
  const user = useUser();
  const schedule = useSchedule();
  const extras = useAsync(async () => {
    const sb = getBrowserClient();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const [docs, due, sessions] = await Promise.all([
      sb.from("documents").select("id,title,status,created_at").order("created_at", { ascending: false }).limit(4),
      sb.from("flashcards").select("id", { count: "exact", head: true }).lte("due_at", new Date().toISOString()),
      sb.from("study_sessions").select("duration_seconds").gte("started_at", todayStart.toISOString()),
    ]);
    if (due.error) throw new Error(due.error.message);
    return {
      docs: unwrap(docs) as Pick<DocumentRow, "id" | "title" | "status" | "created_at">[],
      dueCards: due.count ?? 0,
      focusMinutes: Math.floor((unwrap(sessions) as Array<{ duration_seconds: number | null }>).reduce((n, s) => n + (s.duration_seconds ?? 0), 0) / 60),
    };
  }, []);

  const progress = useAsync(async () => parseMyProgress(unwrap(await getBrowserClient().rpc("my_progress"))), []);

  const now = new Date();
  const todays = schedule.data ? classesOn(schedule.data.timetable, now) : [];
  // The schedule alone decides the agenda; a failed extras query only drops the due-cards row (never a false "all clear").
  const agendaReady = !!schedule.data;
  const agenda = schedule.data ? buildAgenda(schedule.data.tasks, schedule.data.exams, extras.data?.dueCards ?? 0, now) : [];
  const nowHm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  return (
    <div className="dash">
      <header className="dash__head">
        <p className="dash__date" suppressHydrationWarning>{/* clock-dependent text; server and browser may differ near midnight */}{date(now, { weekday: "long", day: "numeric", month: "long" })}</p>
        <h1>{user.displayName ? t("dashboard.greeting", { name: user.displayName }) : t("dashboard.greetingAnon")}</h1>
        <nav className="quick" aria-label={t("dashboard.quickActions")}>
          {QUICK.map((a) => (
            <Link key={a.key} href={a.href} className="quick__item">
              <Icon name={a.icon} size={18} />
              <span>{t(a.key)}</span>
            </Link>
          ))}
        </nav>
      </header>

      {extras.error ? <ErrorState title={t("dashboard.loadFailed")} description={extras.error} /> : null}

      <div className="dash__grid">
        <div className="dash__main">
          <section aria-labelledby="agenda-h" className="panel">
            <div className="panel__head">
              <h2 id="agenda-h">{t("dashboard.agenda.title")}</h2>
              <Link href="/planner">{t("dashboard.openPlanner")}</Link>
            </div>
            {!agendaReady && schedule.loading ? (
              <div className="stack">
                <Skeleton height={56} />
                <Skeleton height={56} />
              </div>
            ) : !agendaReady ? (
              <p className="um-muted">{t("dashboard.loadFailed")}</p>
            ) : agenda.length === 0 ? (
              <p className="agenda__clear">{t("dashboard.agenda.clear")}</p>
            ) : (
              <ol className="agenda">
                {agenda.map((item) => (
                  <AgendaRow key={`${item.kind}-${item.id}`} item={item} />
                ))}
              </ol>
            )}
          </section>

          <section aria-labelledby="docs-h" className="panel">
            <div className="panel__head">
              <h2 id="docs-h">{t("dashboard.recentDocs")}</h2>
              <Link href="/documents">{t("dashboard.allDocs")}</Link>
            </div>
            {extras.loading && !extras.data ? (
              <Skeleton height={80} />
            ) : !extras.data || extras.data.docs.length === 0 ? (
              <EmptyState title={t("documents.empty")} description={t("documents.emptyBody")} action={<Link className="um-btn um-btn--sm" href="/documents">{t("documents.upload")}</Link>} />
            ) : (
              <ul className="doclist">
                {extras.data.docs.map((d) => (
                  <li key={d.id}>
                    <Link href={`/documents/${d.id}`} className="doclist__item">
                      <Icon name="file-pdf" size={20} />
                      <span className="doclist__title">{d.title}</span>
                      <Badge tone={STATUS_TONE[d.status]}>{t(`documents.status.${d.status}`)}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="dash__rail" aria-label={t("dashboard.overview")}>
          <section className="panel progress" aria-labelledby="prog-h">
            <h2 id="prog-h" className="um-sr-only">{t("gamification.progressTitle")}</h2>
            {progress.loading && !progress.data ? (
              <Skeleton height={88} />
            ) : progress.data ? (
              <Link href="/gamification" className="progress__link">
                <ProgressRing value={progress.data.level_progress * 100} label={t("gamification.levelProgress")} size={72}>
                  {percent(progress.data.level_progress, { maximumFractionDigits: 0 })}
                </ProgressRing>
                <div className="progress__text">
                  <span className="progress__level">{t("gamification.level", { n: progress.data.level })}</span>
                  <span className="progress__meta">{t("gamification.xp", { n: number(progress.data.xp) })}</span>
                  <span className="progress__meta">
                    <Icon name="streak" size={16} /> {progress.data.streak.current > 0 ? t("gamification.streak", { n: progress.data.streak.current }) : t("gamification.noStreak")}
                  </span>
                </div>
              </Link>
            ) : (
              <p className="um-muted">{t("gamification.loadFailed")}</p>
            )}
          </section>

          <dl className="metrics">
            <div className="metric">
              <dt>{t("dashboard.dueCards")}</dt>
              <dd>{extras.loading && !extras.data ? <Skeleton height={28} width={48} /> : number(extras.data?.dueCards ?? 0)}</dd>
            </div>
            <div className="metric">
              <dt>{t("dashboard.studyToday")}</dt>
              <dd>{extras.loading && !extras.data ? <Skeleton height={28} width={48} /> : t("dashboard.minutes", { n: extras.data?.focusMinutes ?? 0 })}</dd>
            </div>
          </dl>

          <section aria-labelledby="today-h" className="panel">
            <div className="panel__head">
              <h2 id="today-h">{t("dashboard.today")}</h2>
            </div>
            {schedule.loading && !schedule.data ? (
              <Skeleton height={80} />
            ) : todays.length === 0 ? (
              <p className="um-muted">{t("dashboard.noClasses")}</p>
            ) : (
              <ol className="timeline">
                {todays.map((c) => {
                  const state = hhmm(c.end_time) <= nowHm ? "past" : hhmm(c.start_time) <= nowHm ? "now" : "next";
                  return (
                    <li key={c.id} className={`timeline__item timeline__item--${state}`} aria-current={state === "now" ? "time" : undefined}>
                      <span className="timeline__time">{hhmm(c.start_time)}</span>
                      <div>
                        <span className="timeline__title">{c.title}</span>
                        <span className="timeline__meta">
                          {hhmm(c.start_time)}–{hhmm(c.end_time)}
                          {c.location ? `, ${c.location}` : ""}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
