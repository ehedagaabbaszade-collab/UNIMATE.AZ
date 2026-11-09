"use client";

import { Badge, Button, Card, EmptyState, Skeleton, useToast } from "@unimate/ui";
import { useState } from "react";
import { EdgeNotice } from "@/components/EdgeNotice";
import { useUser } from "@/components/user";
import { aiLanguage } from "@/i18n";
import { useI18n } from "@/i18n/provider";
import type { AttemptRow, QuestionRow, QuizRow } from "@/lib/db";
import type { EdgeError } from "@/lib/edge";
import { generateQuizMaterial } from "@/lib/edge-client";
import { getBrowserClient } from "@/lib/supabase/browser";
import { unwrap, useAsync } from "@/lib/use-async";
import { isCorrect, parseOptions, scoreQuiz, toQuestionRows, type QuizQuestion } from "./quiz";

function QuizTaker({ quiz, onExit }: { quiz: QuizRow; onExit: () => void }) {
  const { t } = useI18n();
  const user = useUser();
  const { toast } = useToast();
  const qs = useAsync<QuizQuestion[]>(async () => {
    const rows = unwrap(await getBrowserClient().from("questions").select("id,quiz_id,position,prompt,options,answer,explanation").eq("quiz_id", quiz.id).order("position")) as QuestionRow[];
    return rows.map((r) => ({ id: r.id, prompt: r.prompt, options: parseOptions(r.options), answer: r.answer, explanation: r.explanation }));
  }, [quiz.id]);

  const [index, setIndex] = useState(0);
  const [choice, setChoice] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [finished, setFinished] = useState<{ score: number; max: number } | null>(null);
  const startedAt = useState(() => new Date().toISOString())[0];

  if (qs.loading) return <Skeleton height={200} />;
  const questions = qs.data ?? [];
  if (questions.length === 0) return <EmptyState title={t("quiz.none")} action={<Button onClick={onExit}>{t("common.back")}</Button>} />;

  async function saveAttempt(final: Record<string, number>) {
    const res = scoreQuiz(questions, final);
    setFinished(res);
    const { error } = await getBrowserClient().from("attempts").insert({
      quiz_id: quiz.id,
      user_id: user.id,
      score: res.score,
      max_score: res.max,
      answers: final,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
    });
    if (error) toast(t("quiz.saveFailed", { reason: error.message }), "error");
    else toast(t("quiz.saved"), "success");
  }

  if (finished)
    return (
      <Card>
        <h2>{t("quiz.score", { a: finished.score, b: finished.max })}</h2>
        <div className="row" style={{ marginTop: "var(--space-4)" }}>
          <Button
            onClick={() => {
              setIndex(0);
              setChoice(null);
              setChecked(false);
              setAnswers({});
              setFinished(null);
            }}
          >
            {t("quiz.retake")}
          </Button>
          <Button variant="secondary" onClick={onExit}>
            {t("common.back")}
          </Button>
        </div>
      </Card>
    );

  const q = questions[index]!;
  const last = index === questions.length - 1;
  return (
    <div className="stack">
      <div className="quiz-progress" aria-hidden="true">
        <span style={{ width: `${((index + (checked ? 1 : 0)) / questions.length) * 100}%` }} />
      </div>
      <p className="um-muted">{t("quiz.question", { a: index + 1, b: questions.length })}</p>
      <fieldset className="seg" style={{ minWidth: 0 }}>
        <legend style={{ fontSize: "var(--text-lg)", fontWeight: 650, marginBottom: "var(--space-3)" }}>{q.prompt}</legend>
        <div className="stack">
          {q.options.map((o, i) => {
            const cls = checked ? (o === q.answer ? "option option--right" : i === choice ? "option option--wrong" : "option") : "option";
            return (
              <label key={i} className={cls}>
                <input type="radio" name={`q-${q.id}`} checked={choice === i} disabled={checked} onChange={() => setChoice(i)} />
                <span>{o}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {checked ? (
        <div role="status" className={isCorrect(q, choice ?? undefined) ? "ok-box" : "err-box"}>
          {isCorrect(q, choice ?? undefined) ? t("quiz.correct") : t("quiz.incorrect", { answer: q.answer })}
          {q.explanation ? (
            <p style={{ fontWeight: 400, marginTop: 4 }}>
              <strong>{t("quiz.explanation")}: </strong>
              {q.explanation}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="row">
        {!checked ? (
          <Button
            disabled={choice === null}
            onClick={() => {
              if (choice === null) return;
              setAnswers((a) => ({ ...a, [q.id]: choice }));
              setChecked(true);
            }}
          >
            {t("quiz.check")}
          </Button>
        ) : (
          <Button
            onClick={() => {
              if (last) void saveAttempt(answers);
              else {
                setIndex(index + 1);
                setChoice(null);
                setChecked(false);
              }
            }}
          >
            {last ? t("quiz.seeResults") : t("quiz.nextQ")}
          </Button>
        )}
        <Button variant="ghost" onClick={onExit}>
          {t("common.close")}
        </Button>
      </div>
    </div>
  );
}

export function QuizPanel({ documentId }: { documentId: string }) {
  const { t, locale, date } = useI18n();
  const user = useUser();
  const quizzes = useAsync(async () => {
    const sb = getBrowserClient();
    const qz = unwrap(await sb.from("quizzes").select("id,title,created_at").eq("document_id", documentId).order("created_at", { ascending: false })) as QuizRow[];
    const ids = qz.map((q) => q.id);
    const attempts = ids.length ? (unwrap(await sb.from("attempts").select("id,quiz_id,score,max_score,started_at,completed_at").in("quiz_id", ids).order("started_at", { ascending: false })) as AttemptRow[]) : [];
    return { qz, attempts };
  }, [documentId]);
  const [active, setActive] = useState<QuizRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<EdgeError | null>(null);
  const [dbErr, setDbErr] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setErr(null);
    setDbErr(null);
    const res = await generateQuizMaterial(documentId, 10, aiLanguage(locale));
    if (!res.ok) {
      setBusy(false);
      setErr(res.error);
      return;
    }
    // The edge function returns the quiz but persists nothing: store it as the signed-in user (RLS owner policies).
    const sb = getBrowserClient();
    const created = await sb
      .from("quizzes")
      .insert({ user_id: user.id, document_id: documentId, title: `${new Date().toLocaleDateString(locale)} · ${res.data.output.questions.length}` })
      .select("id,title,created_at")
      .single<QuizRow>();
    if (created.error) {
      setBusy(false);
      return setDbErr(created.error.message);
    }
    const rows = await sb.from("questions").insert(toQuestionRows(created.data.id, res.data.output.questions));
    setBusy(false);
    if (rows.error) {
      await sb.from("quizzes").delete().eq("id", created.data.id);
      return setDbErr(rows.error.message);
    }
    quizzes.reload();
    setActive(created.data);
  }

  if (active) return <QuizTaker quiz={active} onExit={() => { setActive(null); quizzes.reload(); }} />;

  return (
    <div className="stack">
      {quizzes.loading && !quizzes.data ? <Skeleton height={100} /> : null}
      {quizzes.data && quizzes.data.qz.length === 0 ? <p className="um-muted">{t("quiz.none")}</p> : null}
      {quizzes.data && quizzes.data.qz.length > 0 ? (
        <ul className="list" aria-label={t("quiz.pick")}>
          {quizzes.data.qz.map((q) => {
            const attempts = quizzes.data!.attempts.filter((a) => a.quiz_id === q.id);
            const best = attempts[0];
            return (
              <li key={q.id} className="list-item">
                <div className="list-item__main">
                  <span className="list-item__title">{q.title}</span>
                  <span className="list-item__meta">
                    {best?.completed_at ? t("quiz.attemptLine", { a: best.score, b: best.max_score, date: date(best.completed_at) }) : date(q.created_at)}
                  </span>
                </div>
                <div className="row">
                  {attempts.length > 0 ? <Badge tone="success">{attempts.length}</Badge> : null}
                  <Button size="sm" onClick={() => setActive(q)}>
                    {attempts.length ? t("quiz.retake") : t("quiz.start")}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {err ? <EdgeNotice error={err} /> : null}
      {dbErr ? <p className="err-box" role="alert">{dbErr}</p> : null}
      <div>
        <Button onClick={generate} loading={busy} variant={quizzes.data?.qz.length ? "secondary" : "primary"}>
          {busy ? t("quiz.generating") : t("quiz.generate")}
        </Button>
      </div>
    </div>
  );
}
