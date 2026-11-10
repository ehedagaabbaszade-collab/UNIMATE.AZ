"use client";

import { Badge, Card, EmptyState, ErrorState, Skeleton } from "@unimate/ui";
import Link from "next/link";
import { useUser } from "@/components/user";
import { useI18n } from "@unimate/i18n/react";
import type { DocumentRow } from "@/lib/db";
import { getBrowserClient } from "@/lib/supabase/browser";
import { unwrap, useAsync } from "@/lib/use-async";
import { STATUS_TONE } from "../documents/DocumentsList";
import { classesOn, hhmm, upcomingItems } from "../planner/schedule";
import { useSchedule } from "../planner/useSchedule";

export function Dashboard() {
  const { t, dateTime, date } = useI18n();
  const user = useUser();
  const schedule = useSchedule();
  const extras = useAsync(async () => {
    const sb = getBrowserClient();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const [docs, due, sessions] = await Promise.all([
      sb.from("documents").select("id,title,status,created_at").order("created_at", { ascending: false }).limit(3),
      sb.from("flashcards").select("id", { count: "exact", head: true }).lte("due_at", new Date().toISOString()),
      sb.from("study_sessions").select("duration_seconds").gte("started_at", todayStart.toISOString()),
    ]);
    if (due.error) throw new Error(due.error.message);
    return {
      docs: unwrap(docs) as Pick<DocumentRow, "id" | "title" | "status" | "created_at">[],
      dueCards: due.count ?? 0,
      focusMinutes: Math.floor(((unwrap(sessions) as Array<{ duration_seconds: number | null }>).reduce((n, s) => n + (s.duration_seconds ?? 0), 0)) / 60),
    };
  }, []);

  const now = new Date();
  const todays = schedule.data ? classesOn(schedule.data.timetable, now) : [];
  const upcoming = schedule.data ? upcomingItems(schedule.data.tasks, schedule.data.exams, now) : [];

  return (
    <div className="stack-lg">
      <div className="page-head">
        <p className="eyebrow">{date(now, { weekday: "long", day: "numeric", month: "long" })}</p>
        <h1>{user.displayName ? t("dashboard.greeting", { name: user.displayName }) : t("dashboard.greetingAnon")}</h1>
      </div>

      {extras.error ? <ErrorState title={t("dashboard.loadFailed")} description={extras.error} /> : null}

      <div className="grid-stats">
        <Card>
          <p className="um-muted">{t("dashboard.dueCards")}</p>
          {extras.loading && !extras.data ? <Skeleton height={36} width={60} /> : <p className="stat">{extras.data?.dueCards ?? 0}</p>}
          <Link href="/flashcards">{t("nav.flashcards")}</Link>
        </Card>
        <Card>
          <p className="um-muted">{t("dashboard.studyToday")}</p>
          {extras.loading && !extras.data ? <Skeleton height={36} width={60} /> : <p className="stat">{t("dashboard.minutes", { n: extras.data?.focusMinutes ?? 0 })}</p>}
          <Link href="/focus">{t("dashboard.startFocus")}</Link>
        </Card>
      </div>

      <div className="grid-2">
        <section aria-labelledby="today-h" className="stack">
          <h2 id="today-h">{t("dashboard.today")}</h2>
          {schedule.loading && !schedule.data ? (
            <Skeleton height={80} />
          ) : todays.length === 0 ? (
            <EmptyState title={t("dashboard.noClasses")} action={<Link className="um-btn um-btn--secondary um-btn--sm" href="/planner">{t("dashboard.openPlanner")}</Link>} />
          ) : (
            <ul className="list">
              {todays.map((c) => (
                <li key={c.id} className="list-item">
                  <div className="list-item__main">
                    <span className="list-item__title">{c.title}</span>
                    <span className="list-item__meta">{hhmm(c.start_time)}–{hhmm(c.end_time)}{c.location ? ` · ${c.location}` : ""}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="up-h" className="stack">
          <h2 id="up-h">{t("dashboard.upcoming")}</h2>
          {schedule.loading && !schedule.data ? (
            <Skeleton height={80} />
          ) : upcoming.length === 0 ? (
            <EmptyState title={t("dashboard.nothingUpcoming")} />
          ) : (
            <ul className="list">
              {upcoming.map((u) => (
                <li key={`${u.kind}-${u.id}`} className="list-item">
                  <div className="list-item__main">
                    <span className="list-item__title">{u.title}</span>
                    <span className="list-item__meta">{dateTime(u.at)}</span>
                  </div>
                  <Badge tone={u.kind === "exam" ? "warning" : "neutral"}>{u.kind === "exam" ? t("planner.tabs.exams") : t("planner.taskTitle")}</Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section aria-labelledby="docs-h" className="stack">
        <h2 id="docs-h">{t("dashboard.recentDocs")}</h2>
        {extras.loading && !extras.data ? (
          <Skeleton height={80} />
        ) : !extras.data || extras.data.docs.length === 0 ? (
          <EmptyState title={t("documents.empty")} description={t("documents.emptyBody")} action={<Link className="um-btn um-btn--sm" href="/documents">{t("documents.upload")}</Link>} />
        ) : (
          <ul className="list">
            {extras.data.docs.map((d) => (
              <li key={d.id} className="list-item">
                <Link href={`/documents/${d.id}`} className="list-item__title link-reset">{d.title}</Link>
                <Badge tone={STATUS_TONE[d.status]}>{t(`documents.status.${d.status}`)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
