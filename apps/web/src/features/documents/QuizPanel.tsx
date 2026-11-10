"use client";

import { Badge, Button, Card, EmptyState, Skeleton, useToast } from "@unimate/ui";
import { useState } from "react";
import { EdgeNotice } from "@/components/EdgeNotice";
import { aiLanguage } from "@/i18n";
import { useI18n } from "@/i18n/provider";
import type { AttemptRow, QuizRow } from "@/lib/db";
import type { EdgeError } from "@/lib/edge";
import { generateQuizMaterial } from "@/lib/edge-client";
import { getBrowserClient } from "@/lib/supabase/browser";
import { unwrap, useAsync } from "@/lib/use-async";
import { buildAnswers, parseOptions, parseSubmitResult, type QuizQuestion, type SubmitResult } from "./quiz";

function QuizTaker({ quiz, onExit }: { quiz: QuizRow; onExit: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  // No answer/explanation columns are requested: the key lives server-side and is returned by submit_quiz_attempt.
  const qs = useAsync<QuizQuestion[]>(async () => {
    const rows = unwrap(await getBrowserClient().from("questions").select("id,prompt,options").eq("quiz_id", quiz.id).order("position")) as {
      id: string;
      prompt: string;
      options: unknown;
    }[];
    return rows.map((r) => ({ id: r.id, prompt: r.prompt, options: parseOptions(r.options) }));
  }, [quiz.id]);

  const [index, setIndex] = useState(0);
  const [choices, setChoices] = useState<Record<string, number>>({});
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // One id per finish: a retried submit (network hiccup) is idempotent server-side and never double-awards.
  const [attemptId, setAttemptId] = useState(() => crypto.randomUUID());

  if (qs.loading) return <Skeleton height={200} />;
  const questions = qs.data ?? [];
  if (questions.length === 0) return <EmptyState title={t("quiz.none")} action={<Button onClick={onExit}>{t("common.back")}</Button>} />;

  async function submit() {
    setSubmitting(true);
    const { data, error } = await getBrowserClient().rpc("submit_quiz_attempt", {
      p_quiz_id: quiz.id,
      p_answers: buildAnswers(questions, choices),
      p_attempt_id: attemptId,
    });
    setSubmitting(false);
    const parsed = error ? null : parseSubmitResult(data);
    if (!parsed) return toast(t("quiz.saveFailed", { reason: error?.message ?? t("common.genericError") }), "error");
    setResult(parsed);
    toast(t("quiz.saved"), "success");
  }

  if (result) {
    const byId = new Map(result.results.map((r) => [r.question_id, r]));
    return (
      <Card>
        <h2>{t("quiz.score", { a: result.score, b: result.max_score })}</h2>
        <p role="status" className="um-muted">
          {result.xp_awarded > 0 ? t("quiz.xpEarned", { n: result.xp_awarded }) : t("quiz.noXp")}
        </p>
        <ol className="stack" style={{ marginTop: "var(--space-4)" }}>
          {questions.map((q) => {
            const r = byId.get(q.id);
            const answer = r?.correct_answer ?? (r?.correct_option != null ? q.options[r.correct_option] : undefined) ?? "";
            return (
              <li key={q.id}>
                <strong>{q.prompt}</strong>
                {r && r.correct !== null ? (
                  <div role="status" className={r.correct ? "ok-box" : "err-box"}>
                    {r.correct ? t("quiz.correct") : t("quiz.incorrect", { answer })}
                    {r.explanation ? (
                      <p style={{ fontWeight: 400, marginTop: 4 }}>
                        <strong>{t("quiz.explanation")}: </strong>
                        {r.explanation}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
        <div className="row" style={{ marginTop: "var(--space-4)" }}>
          <Button
            onClick={() => {
              setIndex(0);
              setChoices({});
              setResult(null);
              setAttemptId(crypto.randomUUID());
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
  }

  const q = questions[index]!;
  const last = index === questions.length - 1;
  const choice = choices[q.id];
  return (
    <div className="stack">
      <div className="quiz-progress" aria-hidden="true">
        <span style={{ width: `${(index / questions.length) * 100}%` }} />
      </div>
      <p className="um-muted">{t("quiz.question", { a: index + 1, b: questions.length })}</p>
      <fieldset className="seg" style={{ minWidth: 0 }}>
        <legend style={{ fontSize: "var(--text-lg)", fontWeight: 650, marginBottom: "var(--space-3)" }}>{q.prompt}</legend>
        <div className="stack">
          {q.options.map((o, i) => (
            <label key={i} className="option">
              <input type="radio" name={`q-${q.id}`} checked={choice === i} onChange={() => setChoices((c) => ({ ...c, [q.id]: i }))} />
              <span>{o}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="row">
        <Button disabled={choice === undefined} loading={submitting} onClick={() => (last ? void submit() : setIndex(index + 1))}>
          {last ? t("quiz.seeResults") : t("quiz.nextQ")}
        </Button>
        <Button variant="ghost" onClick={onExit}>
          {t("common.close")}
        </Button>
      </div>
    </div>
  );
}

export function QuizPanel({ documentId }: { documentId: string }) {
  const { t, locale, date } = useI18n();
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
    // The edge function persisted the quiz (and its answer key) server-side; only the id comes back. Read the row (RLS).
    const created = await getBrowserClient().from("quizzes").select("id,title,created_at").eq("id", res.data.output.quizId).single<QuizRow>();
    setBusy(false);
    if (created.error) return setDbErr(created.error.message);
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
