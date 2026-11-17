"use client";

import { examTotalPoints } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { Button, EmptyState } from "@unimate/ui";
import Link from "next/link";
import { useUser } from "@/components/user";
import { useExamStore } from "./store";

/** Teacher home: the exams saved on this device. */
export function ExamsScreen() {
  const { t } = useI18n();
  const { id: uid } = useUser();
  const { exams, ready } = useExamStore(uid);
  const add = (
    <Link href="/teacher/exam/new">
      <Button>{t("teach.exams.new")}</Button>
    </Link>
  );
  return (
    <div className="stack">
      <header className="page-head">
        <h1>
          {t("teach.exams.heroMuted")} {t("teach.exams.heroStrong")}
        </h1>
      </header>
      {ready && exams.length === 0 ? (
        <EmptyState title={t("teach.exams.emptyTitle")} description={t("teach.exams.emptyBody")} action={add} />
      ) : (
        <>
          {exams.map((e) => (
            <Link key={e.id} href={`/teacher/exam/${encodeURIComponent(e.id)}`} className="list-item">
              <span className="list-item__main">
                <span className="list-item__title">{e.title}</span>
                {e.subject || e.group ? <span className="list-item__meta">{[e.subject, e.group].filter(Boolean).join(" · ")}</span> : null}
                <span className="list-item__meta">{t("teach.exams.meta", { q: e.questions.length, p: examTotalPoints(e), m: e.minutes })}</span>
              </span>
            </Link>
          ))}
          {ready ? <div className="row">{add}</div> : null}
        </>
      )}
      <div className="row">
        <Link href="/teacher/bank">{t("teach.exams.bank")}</Link>
        <Link href="/teacher/classes">{t("teach.class.title")}</Link>
      </div>
    </div>
  );
}
