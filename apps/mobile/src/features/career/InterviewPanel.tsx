import { CV_LANGUAGES, INTERVIEW_ANSWER_MAX, INTERVIEW_LEVELS, INTERVIEW_ROLE_MAX, type CvLanguage, type InterviewLevel, type InterviewQuestions, type InterviewScore } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { useState } from "react";
import { View } from "react-native";
import { EdgeNotice } from "../../components/EdgeNotice";
import { AppText, Badge, Button, Card, Input, Segmented } from "../../components/ui";
import type { EdgeError } from "../../lib/edge";
import { interviewQuestions, interviewScore } from "../../lib/edge-client";

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

  const roleOk = role.trim().length >= 2;
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
    if (selected === null || !questions?.[selected]) return;
    setBusy("score");
    setError(null);
    const r = await interviewScore(role.trim(), level, questions[selected]!.question, answer.trim(), lang);
    setBusy(null);
    if (r.ok) {
      setResult(r.data.result);
      setCached(r.data.cached);
    } else setError(r.error);
  };
  const q = selected !== null ? questions?.[selected] : undefined;

  return (
    <View style={{ gap: 12 }}>
      <AppText muted>{t("career.interview.subtitle")}</AppText>
      <Card>
        <Input label={t("career.interview.role")} placeholder={t("career.interview.rolePlaceholder")} value={role} onChangeText={setRole} maxLength={INTERVIEW_ROLE_MAX} />
        <Segmented label={t("career.interview.level")} value={level} onChange={setLevel} options={INTERVIEW_LEVELS.map((l) => ({ value: l, label: t(`career.interview.levels.${l}`) }))} />
        <Segmented label={t("career.interview.lang")} value={lang} onChange={setLang} options={CV_LANGUAGES.map((l) => ({ value: l, label: t(`career.lang.${l}`) }))} />
        <Button title={busy === "questions" ? t("career.interview.working") : t("career.interview.generate")} loading={busy === "questions"} disabled={!roleOk || busy !== null} onPress={() => void generate()} />
      </Card>
      {error ? <EdgeNotice error={error} /> : null}

      {questions ? (
        <View style={{ gap: 12 }}>
          <AppText variant="heading">{t("career.interview.questions")}</AppText>
          {cached ? (
            <AppText variant="caption" muted>
              {t("career.interview.cached")}
            </AppText>
          ) : null}
          {questions.map((it, i) => (
            <Card key={`${i}-${it.question}`} strong={selected === i}>
              <Badge tone="info">{t(`career.interview.category.${it.category}`)}</Badge>
              <AppText variant="heading">{it.question}</AppText>
              <AppText variant="label">{t("career.interview.tips")}</AppText>
              <AppText muted>{it.tips}</AppText>
              <Button
                small
                variant={selected === i ? "primary" : "secondary"}
                title={t("career.interview.practice")}
                onPress={() => {
                  setSelected(i);
                  setAnswer("");
                  setResult(null);
                }}
              />
            </Card>
          ))}
        </View>
      ) : null}

      {q ? (
        <Card strong>
          <AppText variant="label">{q.question}</AppText>
          <Input label={t("career.interview.yourAnswer")} placeholder={t("career.interview.answerPlaceholder")} hint={t("career.interview.answerHint")} value={answer} onChangeText={setAnswer} multiline numberOfLines={6} maxLength={INTERVIEW_ANSWER_MAX} style={{ minHeight: 120, textAlignVertical: "top" }} />
          <Button title={busy === "score" ? t("career.interview.working") : t("career.interview.scoreAction")} loading={busy === "score"} disabled={answer.trim().length < 10 || busy !== null} onPress={() => void score()} />
        </Card>
      ) : null}

      {result ? (
        <Card>
          <AppText variant="title" accessibilityRole="header">
            {t("career.interview.result", { n: result.score })}
          </AppText>
          {result.strengths.length ? (
            <>
              <AppText variant="label">{t("career.interview.strengths")}</AppText>
              {result.strengths.map((s, i) => (
                <AppText key={`s${i}`}>{`• ${s}`}</AppText>
              ))}
            </>
          ) : null}
          <AppText variant="label">{t("career.interview.improvements")}</AppText>
          {result.improvements.map((s, i) => (
            <AppText key={`i${i}`}>{`• ${s}`}</AppText>
          ))}
          <AppText variant="label">{t("career.interview.improvedAnswer")}</AppText>
          <AppText muted>{result.improvedAnswer}</AppText>
        </Card>
      ) : null}
      {questions ? (
        <AppText variant="caption" muted>
          {t("career.interview.disclaimer")}
        </AppText>
      ) : null}
    </View>
  );
}
