"use client";

import { EXAM_LETTERS } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { Button, EmptyState, ErrorState, Skeleton, Textarea } from "@unimate/ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useAsync } from "@/lib/use-async";
import { ClassApiError, clock, saveAnswers, secondsLeft, startExam, submitExam, type Answers } from "./api";
import { useClassError } from "./hooks";

const AUTOSAVE_MS = 20_000;

/** A student sits one class exam: the server owns the deadline; answers are autosaved, and time-up submits them. */
export function TakeExamScreen({ id }: { id: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const onError = useClassError();
  const exam = useAsync(() => startExam(getBrowserClient(), id), [id]);
  const [answers, setAnswers] = useState<Answers>({});
  const [left, setLeft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ score: number; max_score: number; late: boolean; pending_open: boolean } | null>(null);
  const dirty = useRef(false);
  const latest = useRef<Answers>({});
  latest.current = answers;

  // Hydrate once per attempt: a later exam.data change must not overwrite unsaved typing.
  const hydrated = useRef<string | null>(null);
  useEffect(() => {
    if (!exam.data || hydrated.current === exam.data.attempt_id) return;
    hydrated.current = exam.data.attempt_id;
    setAnswers(exam.data.answers ?? {});
  }, [exam.data]);

  async function submit() {
    if (!exam.data || busy || result) return;
    setBusy(true);
    try {
      setResult(await submitExam(getBrowserClient(), exam.data.attempt_id, latest.current));
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  const submitRef = useRef(submit);
  submitRef.current = submit;

  // Countdown from the server deadline; at zero the answers are handed in. The server enforces the deadline itself, so
  // the client only auto-submits after it has seen time left (a clock ahead of the server must not hand in a
  // blank paper on the first tick) and retries a failed time-up submit every 10 s, not every second.
  const sawTime = useRef(false);
  const nextTry = useRef(0);
  useEffect(() => {
    if (!exam.data || result) return;
    const tick = () => {
      const s = secondsLeft(exam.data!.deadline_at);
      setLeft(s);
      if (s > 0) sawTime.current = true;
      else if (sawTime.current && Date.now() >= nextTry.current) {
        nextTry.current = Date.now() + 10_000;
        void submitRef.current();
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [exam.data, result]);

  // Autosave, so a crash or a lost connection never loses more than a few answers.
  useEffect(() => {
    if (!exam.data || result) return;
    const flush = () => {
      if (!dirty.current) return;
      dirty.current = false;
      void saveAnswers(getBrowserClient(), exam.data!.attempt_id, latest.current).catch(() => {
        dirty.current = true;
      });
    };
    const onHide = () => {
      if (document.hidden) flush();
    };
    const timer = setInterval(flush, AUTOSAVE_MS);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
    };
  }, [exam.data, result]);

  const set = (q: string, v: number | string) => {
    dirty.current = true;
    setAnswers((a) => ({ ...a, [q]: v }));
  };

  if (exam.loading && !exam.data) return <Skeleton height={160} />;
  if (!exam.data) {
    const key = exam.error ? new ClassApiError(exam.error).key : "generic";
    return <ErrorState title={t(`teach.class.errors.${key}`)} action={<Button onClick={() => router.back()}>{t("common.back")}</Button>} />;
  }
  if (result)
    return (
      <EmptyState
        title={t("teach.class.submitted")}
        description={[t("teach.class.scoreLine", { s: result.score, m: result.max_score }), result.pending_open ? t("teach.class.openLater") : "", result.late ? t("teach.class.lateNote") : ""].filter(Boolean).join(" ")}
        action={<Button onClick={() => router.back()}>{t("common.back")}</Button>}
      />
    );

  const qs = exam.data.questions;
  const unanswered = qs.filter((q) => answers[q.id] === undefined || answers[q.id] === "").length;
  const urgent = left !== null && left <= 60;
  return (
    <div className="stack">
      <header className="page-head">
        <h1>{exam.data.title}</h1>
      </header>
      <div className="um-card row row--between" style={{ position: "sticky", top: 8, zIndex: 1 }}>
        <span className="um-label">{t("teach.class.timeLeft")}</span>
        <span role="timer" aria-live={urgent ? "polite" : "off"} style={{ fontSize: 28, fontWeight: 300, fontVariantNumeric: "tabular-nums", color: urgent ? "var(--danger)" : undefined }}>
          {left === null ? "--:--" : clock(left)}
        </span>
      </div>
      {qs.map((q, i) => (
        <div key={q.id} className="um-card stack">
          <p className="um-label">{`${i + 1} · ${q.points} ${t("teach.exams.print.points")}`}</p>
          <p style={{ fontSize: 17 }}>{q.text}</p>
          {q.kind === "choice" ? (
            <div role="radiogroup" aria-label={`${i + 1}. ${q.text}`} className="stack" style={{ gap: 8 }}>
              {q.options.map((o, oi) => (
                <label key={oi} className="list-item" style={{ cursor: "pointer", justifyContent: "flex-start", borderColor: answers[q.id] === oi ? "var(--primary, currentColor)" : undefined }}>
                  <input type="radio" name={`q-${q.id}`} checked={answers[q.id] === oi} onChange={() => set(q.id, oi)} />
                  <strong>{EXAM_LETTERS[oi]}</strong>
                  <span>{o}</span>
                </label>
              ))}
            </div>
          ) : (
            <Textarea label={`${i + 1}. ${q.text}`} placeholder={t("teach.class.answerPlaceholder")} value={typeof answers[q.id] === "string" ? (answers[q.id] as string) : ""} onChange={(e) => set(q.id, e.target.value)} maxLength={4000} rows={5} />
          )}
        </div>
      ))}
      <div className="row">
        <Button
          loading={busy}
          onClick={() => {
            if (window.confirm([t("teach.class.submit"), t("teach.class.submitConfirm"), unanswered > 0 ? t("teach.class.unanswered", { n: unanswered }) : ""].filter(Boolean).join("\n"))) void submit();
          }}
        >
          {t("teach.class.submit")}
        </Button>
      </div>
    </div>
  );
}
