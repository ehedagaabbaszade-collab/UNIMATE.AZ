"use client";

import { EXAM_LETTERS } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { Badge, Button, EmptyState, ErrorState, Input, Skeleton, useToast } from "@unimate/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useAsync } from "@/lib/use-async";
import { deleteClassExam, examKey, examResults, gradeOpen, type ExamAttemptRow, type PublicQuestion } from "./api";
import { useClassError } from "./hooks";

/** Teacher: every student's attempt, auto-graded multiple choice, and points for the open answers. */
export function ExamResultsScreen({ id }: { id: string }) {
  const { t, dateTime } = useI18n();
  const router = useRouter();
  const onError = useClassError();
  const key = useAsync(() => examKey(getBrowserClient(), id), [id]);
  const res = useAsync(() => examResults(getBrowserClient(), id), [id]);
  const max = (key.data?.questions ?? []).reduce((n, q) => n + q.points, 0);

  const remove = async () => {
    if (!window.confirm(`${t("teach.class.deleteExam")}\n${t("teach.class.deleteConfirm")}`)) return;
    try {
      await deleteClassExam(getBrowserClient(), id);
      router.back();
    } catch (e) {
      onError(e);
    }
  };

  return (
    <div className="stack">
      <header className="page-head">
        <h1>{t("teach.class.results")}</h1>
      </header>
      {(res.loading && !res.data) || (key.loading && !key.data) ? (
        <Skeleton height={140} />
      ) : !res.data || !key.data ? (
        <ErrorState
          title={t("teach.class.errors.generic")}
          action={
            <Button
              onClick={() => {
                res.reload();
                key.reload();
              }}
            >
              {t("common.retry")}
            </Button>
          }
        />
      ) : res.data.length === 0 ? (
        <EmptyState title={t("teach.class.noAttempts")} />
      ) : (
        res.data.map((a) => <AttemptCard key={a.attempt_id} a={a} questions={key.data!.questions} keys={key.data!.keys} max={max} dateTime={dateTime} onGraded={res.reload} />)
      )}
      <div className="row">
        <Button variant="danger" onClick={() => void remove()}>
          {t("teach.class.deleteExam")}
        </Button>
      </div>
    </div>
  );
}

function AttemptCard({ a, questions, keys, max, dateTime, onGraded }: { a: ExamAttemptRow; questions: PublicQuestion[]; keys: Record<string, number>; max: number; dateTime: (d: string) => string; onGraded: () => void }) {
  const { t } = useI18n();
  const name = a.display_name ?? "—";
  return (
    <details className="um-card">
      <summary className="row row--between">
        <span className="list-item__main">
          <strong>{name}</strong>
          <span className="list-item__meta">{a.submitted_at ? dateTime(a.submitted_at) : t("teach.class.inProgress")}</span>
        </span>
        <Badge tone={a.submitted_at ? "primary" : "neutral"}>{t("teach.class.scoreLine", { s: a.total, m: max })}</Badge>
      </summary>
      <div className="stack" style={{ marginTop: 12 }}>
        {questions.map((q, i) => {
          const ans = a.answers[q.id];
          if (q.kind === "choice") {
            const right = typeof ans === "number" && ans === keys[q.id];
            return (
              <div key={q.id} className="stack" style={{ gap: 4 }}>
                <strong>{`${i + 1}. ${q.text}`}</strong>
                <span className="um-muted">{typeof ans === "number" ? `${EXAM_LETTERS[ans] ?? "?"}) ${q.options[ans] ?? ""}` : t("teach.class.noAnswer")}</span>
                <span>
                  <Badge tone={right ? "success" : "danger"}>{right ? `${t("teach.class.correct")} · ${q.points}` : t("teach.class.wrong")}</Badge>
                </span>
              </div>
            );
          }
          return <OpenGrade key={q.id} index={i} q={q} attempt={a.attempt_id} answer={typeof ans === "string" ? ans : ""} current={a.open_scores[q.id]} canGrade={!!a.submitted_at} onGraded={onGraded} />;
        })}
      </div>
    </details>
  );
}

function OpenGrade({ index, q, attempt, answer, current, canGrade, onGraded }: { index: number; q: PublicQuestion; attempt: string; answer: string; current: number | undefined; canGrade: boolean; onGraded: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const onError = useClassError();
  const [pts, setPts] = useState(current === undefined ? "" : String(current));
  const [busy, setBusy] = useState(false);
  const n = Number(pts.replace(",", "."));
  const valid = pts.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= q.points;
  return (
    <div className="um-card stack">
      <strong>{`${index + 1}. ${q.text}`}</strong>
      <p className={answer ? undefined : "um-muted"} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {answer || t("teach.class.noAnswer")}
      </p>
      {canGrade ? (
        <>
          <Input label={t("teach.class.openMax", { m: q.points })} value={pts} onChange={(e) => setPts(e.target.value.replace(/[^0-9.,]/g, ""))} inputMode="decimal" maxLength={5} />
          <div className="row">
            <Button
              size="sm"
              loading={busy}
              disabled={!valid || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await gradeOpen(getBrowserClient(), attempt, q.id, n);
                  toast(t("teach.class.saved"), "success");
                  onGraded();
                } catch (e) {
                  onError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("teach.class.save")}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
