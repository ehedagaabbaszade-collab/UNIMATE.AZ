import { useI18n } from "@unimate/i18n/react";
import * as Crypto from "expo-crypto";
import { useState } from "react";
import { View } from "react-native";
import { AppText, Button, Card, EmptyState, Skeleton, useToast, PressableScale } from "../../components/ui";
import { buildAnswers, parseOptions, parseSubmitResult, type QuizQuestion, type SubmitResult } from "../../lib/quiz";
import { unwrap, useAsync } from "../../lib/use-async";
import { useUser } from "../../state/session";
import { useTheme } from "../../theme/ThemeProvider";
import { MIN_TOUCH, radii } from "../../theme/tokens";

/**
 * Takes one quiz. The answer key never reaches the device: only id/prompt/options are selected, and grading
 * (score, correct answers, explanations, XP) comes back from the server RPC `submit_quiz_attempt`.
 */
export function QuizTaker({ quizId, onExit }: { quizId: string; onExit: () => void }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const { supabase: sb } = useUser();
  const { toast } = useToast();
  const qs = useAsync<QuizQuestion[]>(async () => {
    const rows = unwrap(await sb.from("questions").select("id,prompt,options").eq("quiz_id", quizId).order("position")) as { id: string; prompt: string; options: unknown }[];
    return rows.map((r) => ({ id: r.id, prompt: r.prompt, options: parseOptions(r.options) }));
  }, [quizId]);

  const [index, setIndex] = useState(0);
  const [choices, setChoices] = useState<Record<string, number>>({});
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // One id per finish: a retried submit (network hiccup) is idempotent server-side and never double-awards.
  const [attemptId, setAttemptId] = useState(() => Crypto.randomUUID());

  if (qs.loading) return <Skeleton height={200} />;
  const questions = qs.data ?? [];
  if (questions.length === 0) return <EmptyState title={t("quiz.none")} action={<Button title={t("common.back")} onPress={onExit} />} />;

  async function submit() {
    setSubmitting(true);
    const { data, error } = await sb.rpc("submit_quiz_attempt", { p_quiz_id: quizId, p_answers: buildAnswers(questions, choices), p_attempt_id: attemptId });
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
        <AppText variant="title" accessibilityRole="header">
          {t("quiz.score", { a: result.score, b: result.max_score })}
        </AppText>
        <AppText muted accessibilityLiveRegion="polite">
          {result.xp_awarded > 0 ? t("quiz.xpEarned", { n: result.xp_awarded }) : t("quiz.noXp")}
        </AppText>
        {questions.map((q) => {
          const r = byId.get(q.id);
          const answer = r?.correct_answer ?? (r?.correct_option != null ? q.options[r.correct_option] : undefined) ?? "";
          return (
            <View key={q.id} style={{ gap: 4, paddingVertical: 8 }}>
              <AppText style={{ fontWeight: "700" }}>{q.prompt}</AppText>
              {r && r.correct !== null ? (
                <AppText style={{ color: r.correct ? theme.success : theme.danger }}>{r.correct ? t("quiz.correct") : t("quiz.incorrect", { answer })}</AppText>
              ) : null}
              {r?.explanation ? (
                <AppText variant="caption" muted>
                  {t("quiz.explanation")}: {r.explanation}
                </AppText>
              ) : null}
            </View>
          );
        })}
        <Button
          title={t("quiz.retake")}
          onPress={() => {
            setIndex(0);
            setChoices({});
            setResult(null);
            setAttemptId(Crypto.randomUUID());
          }}
        />
        <Button title={t("common.back")} variant="secondary" onPress={onExit} />
      </Card>
    );
  }

  const q = questions[index]!;
  const last = index === questions.length - 1;
  const choice = choices[q.id];
  return (
    <View style={{ gap: 12 }}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ height: 6, borderRadius: 3, backgroundColor: theme.cardStrong }}>
        <View style={{ width: `${(index / questions.length) * 100}%`, height: 6, borderRadius: 3, backgroundColor: theme.primary }} />
      </View>
      <AppText muted>{t("quiz.question", { a: index + 1, b: questions.length })}</AppText>
      <AppText variant="heading" accessibilityRole="header">
        {q.prompt}
      </AppText>
      <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
        {q.options.map((o, i) => {
          const on = choice === i;
          return (
            <PressableScale key={i} onPress={() => setChoices((c) => ({ ...c, [q.id]: i }))} accessibilityRole="radio" accessibilityState={{ checked: on }} style={{ minHeight: MIN_TOUCH + 4, padding: 12, borderRadius: radii.md, borderWidth: 1.5, borderColor: on ? theme.primary : theme.border, backgroundColor: on ? theme.primarySoft : theme.card, justifyContent: "center" }}>
              <AppText>{o}</AppText>
            </PressableScale>
          );
        })}
      </View>
      <Button title={last ? t("quiz.seeResults") : t("quiz.nextQ")} disabled={choice === undefined} loading={submitting} onPress={() => (last ? void submit() : setIndex(index + 1))} />
      <Button title={t("common.close")} variant="ghost" onPress={onExit} />
    </View>
  );
}
