import { EXAM_LETTERS, ExamQuestionSchema, ExamSchema, ExamStoreSchema, renderExamHtml, type Exam, type ExamLabels } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { AppText, Button, Card, Dialog, Input, Notice, Screen, ScreenHeader, useToast } from "../../components/ui";
import { newId, useLocalValue } from "../../lib/local-store";
import { haptic } from "../../lib/motion";
import { examsKey } from "../../lib/storage";
import { useAsync } from "../../lib/use-async";
import { useUser } from "../../state/session";
import { useTheme } from "../../theme/ThemeProvider";
import { spacing } from "../../theme/tokens";

/** Editing buffer: numbers stay text while typing. */
interface QDraft {
  id: string;
  kind: "choice" | "open";
  text: string;
  options: string[];
  correct: number;
  points: string;
}
interface Draft {
  title: string;
  subject: string;
  group: string;
  minutes: string;
  questions: QDraft[];
}
const EMPTY: Draft = { title: "", subject: "", group: "", minutes: "45", questions: [] };
const num = (s: string) => Number(s.replace(",", ".").trim() || "NaN");

export function ExamEditor({ id }: { id: string }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const router = useRouter();
  const { toast } = useToast();
  const { user, profile, supabase: sb } = useUser();
  const store = useLocalValue(examsKey(user.id), ExamStoreSchema, { exams: [] });
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exporting, setExporting] = useState<"paper" | "key" | null>(null);
  const isNew = id === "new";
  const uni = useAsync(async () => {
    if (!profile?.university_id) return null;
    const r = await sb.from("universities").select("name").eq("id", profile.university_id).maybeSingle<{ name: string }>();
    return r.data?.name ?? null;
  }, [user.id]);

  useEffect(() => {
    if (!store.ready || loaded) return;
    const e = store.value.exams.find((x) => x.id === id);
    if (e) setDraft({ title: e.title, subject: e.subject, group: e.group, minutes: String(e.minutes), questions: e.questions.map((q) => ({ ...q, points: String(q.points) })) });
    setLoaded(true);
  }, [store.ready, store.value, loaded, id]);

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const patchQ = (qi: number, p: Partial<QDraft>) => setDraft((d) => ({ ...d, questions: d.questions.map((q, i) => (i === qi ? { ...q, ...p } : q)) }));
  const addQuestion = (kind: "choice" | "open") => setDraft((d) => ({ ...d, questions: [...d.questions, { id: newId(), kind, text: "", options: kind === "choice" ? ["", ""] : [], correct: 0, points: "1" }] }));

  const fail = (msg: string): null => {
    haptic.error();
    setError(msg);
    return null;
  };
  /** Returns the validated exam, or sets a specific error. */
  const build = (): Exam | null => {
    setError(null);
    const minutes = num(draft.minutes);
    if (!draft.title.trim()) return fail(t("teach.exams.errTitle"));
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 600) return fail(t("teach.exams.errMinutes"));
    if (draft.questions.length === 0) return fail(t("teach.exams.errQuestions"));
    const questions = draft.questions.map((q) => ({ ...q, options: q.kind === "choice" ? q.options : [], points: num(q.points) }));
    const bad = questions.findIndex((q) => !ExamQuestionSchema.safeParse(q).success);
    if (bad >= 0) return fail(t("teach.exams.errQuestion", { n: bad + 1 }));
    const parsed = ExamSchema.safeParse({ id: isNew ? newId() : id, title: draft.title, subject: draft.subject, group: draft.group, minutes, questions });
    return parsed.success ? parsed.data : fail(t("common.genericError"));
  };

  const save = () => {
    const exam = build();
    if (!exam) return;
    const ok = store.update((s) => ({ exams: s.exams.some((x) => x.id === exam.id) ? s.exams.map((x) => (x.id === exam.id ? exam : x)) : [exam, ...s.exams] }));
    if (!ok) {
      fail(t("common.genericError"));
      return;
    }
    haptic.success();
    toast(t("teach.exams.saved"), "success");
    router.back();
  };

  const remove = () => {
    store.update((s) => ({ exams: s.exams.filter((x) => x.id !== id) }));
    setConfirmDelete(false);
    router.back();
  };

  const labels = (): ExamLabels => ({ subject: t("teach.exams.fSubject"), group: t("teach.exams.fGroup"), fullName: t("teach.exams.print.fullName"), date: t("teach.exams.print.date"), duration: t("teach.exams.print.duration"), minutes: t("teach.exams.print.minutes"), points: t("teach.exams.print.points"), totalPoints: t("teach.exams.print.totalPoints"), answerKey: t("teach.exams.print.answerKey"), openAnswer: t("teach.exams.print.openAnswer") });
  async function share(key: boolean) {
    const exam = build();
    if (!exam) return;
    setExporting(key ? "key" : "paper");
    try {
      const file = await Print.printToFileAsync({ html: renderExamHtml(exam, labels(), { ...(uni.data ? { university: uni.data } : {}), key }) });
      if (!(await Sharing.isAvailableAsync())) toast(t("teach.exams.sharingUnavailable"), "error");
      else await Sharing.shareAsync(file.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
    } catch {
      toast(t("teach.exams.exportFailed"), "error");
    } finally {
      setExporting(null);
    }
  }

  const total = draft.questions.reduce((n, q) => n + (Number.isFinite(num(q.points)) ? num(q.points) : 0), 0);
  return (
    <Screen>
      <ScreenHeader title={isNew ? t("teach.exams.new") : t("teach.exams.editTitle")} />
      <Card>
        <Input label={t("teach.exams.fTitle")} value={draft.title} onChangeText={(v) => patch({ title: v })} maxLength={200} />
        <Input label={t("teach.exams.fSubject")} value={draft.subject} onChangeText={(v) => patch({ subject: v })} maxLength={120} />
        <Input label={t("teach.exams.fGroup")} value={draft.group} onChangeText={(v) => patch({ group: v })} maxLength={60} />
        <Input label={t("teach.exams.fMinutes")} value={draft.minutes} onChangeText={(v) => patch({ minutes: v.replace(/\D/g, "") })} keyboardType="number-pad" maxLength={3} />
      </Card>

      <AppText variant="heading" accessibilityRole="header">
        {t("teach.exams.questions")}
      </AppText>
      {draft.questions.length === 0 ? <AppText muted>{t("teach.exams.noQuestions")}</AppText> : null}
      {draft.questions.map((q, qi) => (
        <Card key={q.id}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <AppText variant="label">{`${qi + 1}. ${q.kind === "choice" ? t("teach.exams.kindChoice") : t("teach.exams.kindOpen")}`}</AppText>
            <Button small variant="ghost" title={t("common.delete")} accessibilityLabel={t("teach.exams.removeQuestion", { n: qi + 1 })} onPress={() => setDraft((d) => ({ ...d, questions: d.questions.filter((x) => x.id !== q.id) }))} />
          </View>
          <Input label={t("teach.exams.qText", { n: qi + 1 })} value={q.text} onChangeText={(v) => patchQ(qi, { text: v })} multiline maxLength={1000} style={{ minHeight: 72, textAlignVertical: "top" }} />
          {q.options.map((o, oi) => {
            const letter = EXAM_LETTERS[oi]!;
            const on = q.correct === oi;
            return (
              <View key={oi} style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.sm }}>
                <Pressable onPress={() => patchQ(qi, { correct: oi })} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={t("teach.exams.markCorrect", { letter })} hitSlop={6} style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: on ? theme.success : theme.border, backgroundColor: on ? theme.success : "transparent", alignItems: "center", justifyContent: "center" }}>
                  <AppText variant="label" style={{ color: on ? "#fff" : theme.text }}>
                    {letter}
                  </AppText>
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Input label={t("teach.exams.option", { letter })} value={o} maxLength={300} onChangeText={(v) => patchQ(qi, { options: q.options.map((x, i) => (i === oi ? v : x)) })} />
                </View>
                {q.options.length > 2 ? <Button small variant="ghost" title="✕" accessibilityLabel={t("teach.exams.removeOption", { letter })} onPress={() => patchQ(qi, { options: q.options.filter((_, i) => i !== oi), correct: q.correct === oi ? 0 : q.correct > oi ? q.correct - 1 : q.correct })} /> : null}
              </View>
            );
          })}
          {q.kind === "choice" && q.options.length < 6 ? <Button small variant="secondary" title={t("teach.exams.addOption")} onPress={() => patchQ(qi, { options: [...q.options, ""] })} /> : null}
          <Input label={t("teach.exams.points")} value={q.points} onChangeText={(v) => patchQ(qi, { points: v.replace(/[^0-9.,]/g, "") })} keyboardType="decimal-pad" maxLength={5} />
        </Card>
      ))}
      <Button variant="secondary" title={t("teach.exams.addChoice")} onPress={() => addQuestion("choice")} />
      <Button variant="secondary" title={t("teach.exams.addOpen")} onPress={() => addQuestion("open")} />
      <AppText muted>{`${t("teach.exams.print.totalPoints")}: ${total}`}</AppText>

      {error ? <Notice text={error} /> : null}
      <Button title={t("teach.exams.save")} onPress={save} />
      <Button variant="secondary" title={t("teach.exams.exportPaper")} loading={exporting === "paper"} onPress={() => void share(false)} />
      <Button variant="secondary" title={t("teach.exams.exportKey")} loading={exporting === "key"} onPress={() => void share(true)} />
      {!isNew ? <Button variant="danger" title={t("teach.exams.deleteExam")} onPress={() => setConfirmDelete(true)} /> : null}

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t("teach.exams.deleteExam")}
        actions={
          <>
            <Button title={t("common.delete")} variant="danger" onPress={remove} />
            <Button title={t("common.cancel")} variant="secondary" onPress={() => setConfirmDelete(false)} />
          </>
        }
      >
        <AppText>{t("teach.exams.deleteConfirm")}</AppText>
      </Dialog>
    </Screen>
  );
}
