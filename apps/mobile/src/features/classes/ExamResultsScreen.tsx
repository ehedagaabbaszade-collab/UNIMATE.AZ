import { EXAM_LETTERS } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, View } from "react-native";
import { AppText, Badge, Button, Card, EmptyState, ErrorState, ExpandCard, Input, Screen, ScreenHeader, Skeleton, useToast } from "../../components/ui";
import { useAsync } from "../../lib/use-async";
import { useUser } from "../../state/session";
import { spacing } from "../../theme/tokens";
import { deleteClassExam, examKey, examResults, gradeOpen, type ExamAttemptRow, type PublicQuestion } from "./api";
import { useClassError } from "./ClassesScreen";

/** Teacher: every student's attempt, auto-graded multiple choice, and points for the open answers. */
export function ExamResultsScreen({ id }: { id: string }) {
  const { t, dateTime } = useI18n();
  const router = useRouter();
  const onError = useClassError();
  const { supabase: sb } = useUser();
  const key = useAsync(() => examKey(sb, id), [sb, id]);
  const res = useAsync(() => examResults(sb, id), [sb, id]);
  const max = (key.data?.questions ?? []).reduce((n, q) => n + q.points, 0);

  const remove = () =>
    Alert.alert(t("teach.class.deleteExam"), t("teach.class.deleteConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: async () => {
          try {
            await deleteClassExam(sb, id);
            router.back();
          } catch (e) {
            onError(e);
          }
        },
      },
    ]);

  return (
    <Screen ambient>
      <ScreenHeader title={t("teach.class.results")} />
      {(res.loading && !res.data) || (key.loading && !key.data) ? (
        <Skeleton height={140} />
      ) : !res.data || !key.data ? (
        <ErrorState title={t("teach.class.errors.generic")} action={<Button title={t("common.retry")} onPress={() => { res.reload(); key.reload(); }} />} />
      ) : res.data.length === 0 ? (
        <EmptyState title={t("teach.class.noAttempts")} />
      ) : (
        res.data.map((a) => <AttemptCard key={a.attempt_id} a={a} questions={key.data!.questions} keys={key.data!.keys} max={max} dateTime={dateTime} onGraded={res.reload} />)
      )}
      <Button variant="danger" title={t("teach.class.deleteExam")} onPress={remove} />
    </Screen>
  );
}

function AttemptCard({ a, questions, keys, max, dateTime, onGraded }: { a: ExamAttemptRow; questions: PublicQuestion[]; keys: Record<string, number>; max: number; dateTime: (d: string) => string; onGraded: () => void }) {
  const { t } = useI18n();
  const name = a.display_name ?? "—";
  const header = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
      <View style={{ flex: 1 }}>
        <AppText variant="heading" numberOfLines={1}>
          {name}
        </AppText>
        <AppText variant="caption" muted>
          {a.submitted_at ? dateTime(a.submitted_at) : t("teach.class.inProgress")}
        </AppText>
      </View>
      <Badge tone={a.submitted_at ? "primary" : "neutral"}>{t("teach.class.scoreLine", { s: a.total, m: max })}</Badge>
    </View>
  );
  return (
    <ExpandCard label={name} header={header}>
      {questions.map((q, i) => {
        const ans = a.answers[q.id];
        if (q.kind === "choice") {
          const right = typeof ans === "number" && ans === keys[q.id];
          return (
            <View key={q.id} style={{ gap: 4 }}>
              <AppText variant="label">{`${i + 1}. ${q.text}`}</AppText>
              <AppText variant="caption" muted>
                {typeof ans === "number" ? `${EXAM_LETTERS[ans] ?? "?"}) ${q.options[ans] ?? ""}` : t("teach.class.noAnswer")}
              </AppText>
              <Badge tone={right ? "success" : "danger"}>{right ? `${t("teach.class.correct")} · ${q.points}` : t("teach.class.wrong")}</Badge>
            </View>
          );
        }
        return <OpenGrade key={q.id} index={i} q={q} attempt={a.attempt_id} answer={typeof ans === "string" ? ans : ""} current={a.open_scores[q.id]} canGrade={!!a.submitted_at} onGraded={onGraded} />;
      })}
    </ExpandCard>
  );
}

function OpenGrade({ index, q, attempt, answer, current, canGrade, onGraded }: { index: number; q: PublicQuestion; attempt: string; answer: string; current: number | undefined; canGrade: boolean; onGraded: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const onError = useClassError();
  const { supabase: sb } = useUser();
  const [pts, setPts] = useState(current === undefined ? "" : String(current));
  const [busy, setBusy] = useState(false);
  const n = Number(pts.replace(",", "."));
  const valid = pts.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= q.points;
  return (
    <Card style={{ gap: spacing.sm }}>
      <AppText variant="label">{`${index + 1}. ${q.text}`}</AppText>
      <AppText selectable muted={!answer}>
        {answer || t("teach.class.noAnswer")}
      </AppText>
      {canGrade ? (
        <>
          <Input label={t("teach.class.openMax", { m: q.points })} value={pts} onChangeText={(v) => setPts(v.replace(/[^0-9.,]/g, ""))} keyboardType="decimal-pad" maxLength={5} />
          <Button
            small
            title={t("teach.class.save")}
            loading={busy}
            disabled={!valid || busy}
            onPress={async () => {
              setBusy(true);
              try {
                await gradeOpen(sb, attempt, q.id, n);
                toast(t("teach.class.saved"), "success");
                onGraded();
              } catch (e) {
                onError(e);
              } finally {
                setBusy(false);
              }
            }}
          />
        </>
      ) : null}
    </Card>
  );
}
