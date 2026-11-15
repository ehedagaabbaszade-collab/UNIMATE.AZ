import { EXAM_DIFFICULTIES, type ExamGenResult } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { useState } from "react";
import { EdgeNotice } from "../../components/EdgeNotice";
import { PickerField } from "../../components/PickerField";
import { AppText, Button, ExpandCard, Input, Segmented } from "../../components/ui";
import type { EdgeError } from "../../lib/edge";
import { generateExamQuestions } from "../../lib/edge-client";
import { haptic } from "../../lib/motion";
import { useAsync } from "../../lib/use-async";
import { useUser } from "../../state/session";

const CHOICE_COUNTS = ["0", "5", "10", "15"] as const;
const OPEN_COUNTS = ["0", "1", "2", "3"] as const;

/** Folded card in the exam editor: AI drafts questions (with the key) from a topic or one of the teacher's own documents. */
export function AiQuestions({ subject, onQuestions }: { subject: string; onQuestions: (qs: ExamGenResult["questions"]) => void }) {
  const { t, locale } = useI18n();
  const { supabase: sb } = useUser();
  const [source, setSource] = useState<"topic" | "doc">("topic");
  const [topic, setTopic] = useState("");
  const [doc, setDoc] = useState("");
  const [choice, setChoice] = useState<(typeof CHOICE_COUNTS)[number]>("5");
  const [open, setOpen] = useState<(typeof OPEN_COUNTS)[number]>("1");
  const [difficulty, setDifficulty] = useState<(typeof EXAM_DIFFICULTIES)[number]>("medium");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<EdgeError | null>(null);
  // RLS limits documents to the caller's own; only processed ones can be a source.
  const docs = useAsync(
    async () => {
      const r = await sb.from("documents").select("id,title").eq("status", "ready").order("created_at", { ascending: false }).limit(100);
      if (r.error) throw new Error(r.error.message);
      return (r.data ?? []) as Array<{ id: string; title: string }>;
    },
    [source],
    source === "doc",
  );

  const count = Number(choice) + Number(open);
  const ready = count > 0 && (source === "topic" ? topic.trim().length >= 3 : !!doc);
  async function run() {
    setBusy(true);
    setError(null);
    const r = await generateExamQuestions({
      ...(source === "topic" ? { topic: topic.trim() } : { documentId: doc }),
      ...(subject.trim() ? { subject: subject.trim() } : {}),
      choiceCount: Number(choice),
      openCount: Number(open),
      difficulty,
      outputLanguage: locale,
    });
    setBusy(false);
    if (!r.ok) {
      haptic.error();
      setError(r.error);
      return;
    }
    haptic.success();
    onQuestions(r.data.questions);
  }

  return (
    <ExpandCard label={t("teach.exams.ai.title")} header={<AppText variant="heading">{t("teach.exams.ai.title")}</AppText>}>
      <Segmented label={t("teach.exams.ai.title")} value={source} onChange={setSource} options={[{ value: "topic", label: t("teach.exams.ai.sourceTopic") }, { value: "doc", label: t("teach.exams.ai.sourceDoc") }]} />
      {source === "topic" ? (
        <Input label={t("teach.exams.ai.topic")} placeholder={t("teach.exams.ai.topicHint")} value={topic} onChangeText={setTopic} maxLength={500} multiline />
      ) : docs.error && !docs.data ? (
        <Button small variant="secondary" title={t("common.retry")} onPress={docs.reload} />
      ) : docs.data && docs.data.length === 0 ? (
        <AppText muted>{t("teach.exams.ai.noDocs")}</AppText>
      ) : (
        <PickerField label={t("teach.exams.ai.doc")} loading={docs.loading && !docs.data} sections={[{ data: (docs.data ?? []).map((d) => ({ id: d.id, label: d.title })) }]} value={doc} onChange={setDoc} searchable />
      )}
      <AppText variant="label">{t("teach.exams.ai.choice")}</AppText>
      <Segmented label={t("teach.exams.ai.choice")} value={choice} onChange={setChoice} options={CHOICE_COUNTS.map((v) => ({ value: v, label: v }))} />
      <AppText variant="label">{t("teach.exams.ai.open")}</AppText>
      <Segmented label={t("teach.exams.ai.open")} value={open} onChange={setOpen} options={OPEN_COUNTS.map((v) => ({ value: v, label: v }))} />
      <AppText variant="label">{t("teach.exams.ai.difficulty")}</AppText>
      <Segmented label={t("teach.exams.ai.difficulty")} value={difficulty} onChange={setDifficulty} options={EXAM_DIFFICULTIES.map((v) => ({ value: v, label: t(`teach.exams.ai.${v}`) }))} />
      <AppText variant="caption" muted>
        {t("teach.exams.ai.hint")}
      </AppText>
      {error ? <EdgeNotice error={error} /> : null}
      <Button title={t("teach.exams.ai.generate")} loading={busy} disabled={!ready || busy} onPress={() => void run()} />
    </ExpandCard>
  );
}
