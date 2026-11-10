"use client";

import { CV_LANGUAGES, INTERVIEW_ANSWER_MAX, INTERVIEW_LEVELS, INTERVIEW_ROLE_MAX, type CvLanguage, type InterviewLevel, type InterviewQuestions, type InterviewScore } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { Badge, Button, Card, Input, Textarea } from "@unimate/ui";
import { useState } from "react";
import { EdgeNotice } from "@/components/EdgeNotice";
import type { EdgeError } from "@/lib/edge";
import { interviewQuestions, interviewScore } from "@/lib/edge-client";
import { Chips } from "./parts";

type Question = InterviewQuestions["questions"][number];

/** Interview prep: role-specific questions with tips, then a typed answer scored with feedback. Both calls go through the guarded AI pipeline. */
export function InterviewPanel() {
  const { t, locale } = useI18n();
  const [role, setRole] = useState("");
  const [level, setLevel] = useState<InterviewLevel>("intern");
  const [lang, setLang] = useState<CvLanguage>((CV_LANGUAGES as readonly string[]).includes(locale) ? (locale as CvLanguage) : "az");
  const [busy, setBusy] = useState<"questions" | "score" | null>(null);
  const [error, setError] = useState<EdgeError | null>(null);
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<InterviewScore | null>(null);
  const [cached, setCached] = useState(false);

  const generate = async () => {
    setBusy("questions");
    setError(null);
    setResult(null);
    setSelected(null);
    const r = await interviewQuestions(role.trim(), level, lang);
    setBusy(null);
    if (r.ok) {
      setQuestions(r.data.result.questions);
      setCached(r.data.cached);
    } else setError(r.error);
  };
  const score = async () => {
    const q = selected !== null ? questions?.[selected] : undefined;
    if (!q) return;
    setBusy("score");
    setError(null);
    const r = await interviewScore(role.trim(), level, q.question, answer.trim(), lang);
    setBusy(null);
    if (r.ok) {
      setResult(r.data.result);
      setCached(r.data.cached);
    } else setError(r.error);
  };
  const q = selected !== null ? questions?.[selected] : undefined;

  return (
    <div className="stack-lg">
      <p className="um-muted">{t("career.interview.subtitle")}</p>
      <Card>
        <div className="stack">
          <Input label={t("career.interview.role")} placeholder={t("career.interview.rolePlaceholder")} value={role} maxLength={INTERVIEW_ROLE_MAX} onChange={(e) => setRole(e.target.value)} />
          <Chips label={t("career.interview.level")} value={level} onChange={setLevel} options={INTERVIEW_LEVELS.map((l) => ({ value: l, label: t(`career.interview.levels.${l}`) }))} />
          <Chips label={t("career.interview.lang")} value={lang} onChange={setLang} options={CV_LANGUAGES.map((l) => ({ value: l, label: t(`career.lang.${l}`) }))} />
          <div className="row">
            <Button loading={busy === "questions"} disabled={role.trim().length < 2 || busy !== null} onClick={() => void generate()}>
              {busy === "questions" ? t("career.interview.working") : t("career.interview.generate")}
            </Button>
          </div>
        </div>
      </Card>
      {error ? <EdgeNotice error={error} /> : null}

      {questions ? (
        <section className="stack" aria-label={t("career.interview.questions")}>
          <h2>{t("career.interview.questions")}</h2>
          {cached ? <p className="um-muted">{t("career.interview.cached")}</p> : null}
          {questions.map((it, i) => (
            <Card key={`${i}-${it.question}`}>
              <div className="stack">
                <Badge tone="info">{t(`career.interview.category.${it.category}`)}</Badge>
                <h3>{it.question}</h3>
                <p>
                  <strong>{t("career.interview.tips")}</strong>
                </p>
                <p className="um-muted">{it.tips}</p>
                <div className="row">
                  <Button
                    size="sm"
                    variant={selected === i ? "primary" : "secondary"}
                    onClick={() => {
                      setSelected(i);
                      setAnswer("");
                      setResult(null);
                    }}
                  >
                    {t("career.interview.practice")}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </section>
      ) : null}

      {q ? (
        <Card>
          <div className="stack">
            <p>
              <strong>{q.question}</strong>
            </p>
            <Textarea label={t("career.interview.yourAnswer")} placeholder={t("career.interview.answerPlaceholder")} hint={t("career.interview.answerHint")} rows={6} maxLength={INTERVIEW_ANSWER_MAX} value={answer} onChange={(e) => setAnswer(e.target.value)} />
            <div className="row">
              <Button loading={busy === "score"} disabled={answer.trim().length < 10 || busy !== null} onClick={() => void score()}>
                {busy === "score" ? t("career.interview.working") : t("career.interview.scoreAction")}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {result ? (
        <Card>
          <div className="stack" role="status">
            <h2>{t("career.interview.result", { n: result.score })}</h2>
            {result.strengths.length ? (
              <>
                <h3>{t("career.interview.strengths")}</h3>
                <ul>
                  {result.strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </>
            ) : null}
            <h3>{t("career.interview.improvements")}</h3>
            <ul>
              {result.improvements.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
            <h3>{t("career.interview.improvedAnswer")}</h3>
            <p className="um-muted">{result.improvedAnswer}</p>
          </div>
        </Card>
      ) : null}
      {questions ? <p className="um-muted">{t("career.interview.disclaimer")}</p> : null}
    </div>
  );
}
