import { EXAM_LETTERS } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, TextInput, View } from "react-native";
import { AppText, Button, Card, EmptyState, ErrorState, Screen, ScreenHeader, Skeleton } from "../../components/ui";
import { haptic } from "../../lib/motion";
import { useAsync } from "../../lib/use-async";
import { useUser } from "../../state/session";
import { useTheme } from "../../theme/ThemeProvider";
import { MIN_TOUCH, radii, spacing } from "../../theme/tokens";
import { ClassApiError, clock, saveAnswers, secondsLeft, startExam, submitExam, type Answers } from "./api";
import { useClassError } from "./ClassesScreen";

const AUTOSAVE_MS = 20_000;

/** A student sits one class exam: the server owns the deadline; answers are autosaved, and time-up submits them. */
export function TakeExamScreen({ id }: { id: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const { theme } = useTheme();
  const onError = useClassError();
  const { supabase: sb } = useUser();
  const exam = useAsync(() => startExam(sb, id), [sb, id]);
  const [answers, setAnswers] = useState<Answers>({});
  const [left, setLeft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ score: number; max_score: number; late: boolean; pending_open: boolean } | null>(null);
  const dirty = useRef(false);
  const latest = useRef<Answers>({});
  latest.current = answers;

  useEffect(() => {
    if (exam.data) setAnswers(exam.data.answers ?? {});
  }, [exam.data]);

  async function submit() {
    if (!exam.data || busy || result) return;
    setBusy(true);
    try {
      const r = await submitExam(sb, exam.data.attempt_id, latest.current);
      haptic.success();
      setResult(r);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  const submitRef = useRef(submit);
  submitRef.current = submit;

  // Countdown from the server deadline; at zero the answers are handed in. The server enforces the deadline itself, so
  // the client only auto-submits after it has seen time left (a phone clock ahead of the server must not hand in a
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
    const timer = setInterval(() => {
      if (!dirty.current) return;
      dirty.current = false;
      void saveAnswers(sb, exam.data!.attempt_id, latest.current).catch(() => {
        dirty.current = true;
      });
    }, AUTOSAVE_MS);
    return () => clearInterval(timer);
  }, [exam.data, result, sb]);

  const set = (q: string, v: number | string) => {
    dirty.current = true;
    setAnswers((a) => ({ ...a, [q]: v }));
  };

  if (exam.loading && !exam.data) return <Screen><ScreenHeader title={t("teach.class.exams")} /><Skeleton height={160} /></Screen>;
  if (!exam.data) {
    const key = exam.error ? new ClassApiError(exam.error).key : "generic";
    return (
      <Screen>
        <ScreenHeader title={t("teach.class.exams")} />
        <ErrorState title={t(`teach.class.errors.${key}`)} action={<Button title={t("common.back")} onPress={() => router.back()} />} />
      </Screen>
    );
  }
  if (result)
    return (
      <Screen ambient>
        <ScreenHeader title={exam.data.title} />
        <EmptyState
          title={t("teach.class.submitted")}
          description={[t("teach.class.scoreLine", { s: result.score, m: result.max_score }), result.pending_open ? t("teach.class.openLater") : "", result.late ? t("teach.class.lateNote") : ""].filter(Boolean).join("\n")}
          action={<Button title={t("common.back")} onPress={() => router.back()} />}
        />
      </Screen>
    );

  const qs = exam.data.questions;
  const unanswered = qs.filter((q) => answers[q.id] === undefined || answers[q.id] === "").length;
  const urgent = left !== null && left <= 60;
  return (
    <Screen ambient>
      <ScreenHeader title={exam.data.title} />
      <Card style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <AppText variant="label" muted>
          {t("teach.class.timeLeft")}
        </AppText>
        <AppText accessibilityLiveRegion={urgent ? "polite" : "none"} style={{ fontSize: 28, fontWeight: "300", fontVariant: ["tabular-nums"], color: urgent ? theme.danger : theme.text }}>
          {left === null ? "--:--" : clock(left)}
        </AppText>
      </Card>
      {qs.map((q, i) => (
        <Card key={q.id} style={{ gap: spacing.sm }}>
          <AppText variant="label" muted>{`${i + 1} · ${q.points} ${t("teach.exams.print.points")}`}</AppText>
          <AppText style={{ fontSize: 17 }}>{q.text}</AppText>
          {q.kind === "choice" ? (
            <View accessibilityRole="radiogroup" style={{ gap: spacing.sm }}>
              {q.options.map((o, oi) => {
                const on = answers[q.id] === oi;
                return (
                  <Pressable
                    key={oi}
                    onPress={() => {
                      haptic.select();
                      set(q.id, oi);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`${EXAM_LETTERS[oi]}) ${o}`}
                    style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: MIN_TOUCH, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.md, borderCurve: "continuous", borderWidth: 1.5, borderColor: on ? theme.active : theme.border, backgroundColor: on ? theme.primarySoft : "transparent" }}
                  >
                    <AppText variant="label" style={{ color: on ? theme.active : theme.textMuted, width: 18 }}>
                      {EXAM_LETTERS[oi]}
                    </AppText>
                    <AppText style={{ flex: 1 }}>{o}</AppText>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <TextInput
              value={typeof answers[q.id] === "string" ? (answers[q.id] as string) : ""}
              onChangeText={(v) => set(q.id, v)}
              placeholder={t("teach.class.answerPlaceholder")}
              placeholderTextColor={theme.textMuted}
              accessibilityLabel={`${i + 1}. ${q.text}`}
              multiline
              maxLength={4000}
              style={{ minHeight: 110, textAlignVertical: "top", color: theme.text, fontSize: 16, borderWidth: 1, borderColor: theme.border, borderRadius: radii.md, padding: spacing.md, backgroundColor: theme.inputBg }}
            />
          )}
        </Card>
      ))}
      <Button
        title={t("teach.class.submit")}
        loading={busy}
        onPress={() =>
          Alert.alert(t("teach.class.submit"), [t("teach.class.submitConfirm"), unanswered > 0 ? t("teach.class.unanswered", { n: unanswered }) : ""].filter(Boolean).join("\n"), [
            { text: t("common.cancel"), style: "cancel" },
            { text: t("teach.class.submit"), onPress: () => void submit() },
          ])
        }
      />
    </Screen>
  );
}
