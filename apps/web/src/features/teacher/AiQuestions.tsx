"use client";

import { EXAM_DIFFICULTIES, type ExamGenResult } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { Button, Select, Textarea } from "@unimate/ui";
import { useState } from "react";
import { EdgeNotice } from "@/components/EdgeNotice";
import type { EdgeError } from "@/lib/edge";
import { generateExamQuestions } from "@/lib/edge-client";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useAsync } from "@/lib/use-async";
import { Chips } from "../career/parts";

const CHOICE_COUNTS = ["0", "5", "10", "15"] as const;
const OPEN_COUNTS = ["0", "1", "2", "3"] as const;

/** Folded card in the exam editor: AI drafts questions (with the key) from a topic or one of the teacher's own documents. */
export function AiQuestions({ subject, onQuestions }: { subject: string; onQuestions: (qs: ExamGenResult["questions"]) => void }) {
  const { t, locale } = useI18n();
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
      const r = await getBrowserClient().from("documents").select("id,title").eq("status", "ready").order("created_at", { ascending: false }).limit(100);
      if (r.error) throw new Error(r.error.message);
      return (r.data ?? []) as Array<{ id: string; title: string }>;
    },
    [source],
    source === "doc",
  );

  const ready = Number(choice) + Number(open) > 0 && (source === "topic" ? topic.trim().length >= 3 : !!doc);
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
    if (!r.ok) return setError(r.error);
    onQuestions(r.data.questions);
  }

  return (
    <details className="um-card">
      <summary>
        <strong>{t("teach.exams.ai.title")}</strong>
      </summary>
      <div className="stack" style={{ marginTop: 12 }}>
        <Chips label={t("teach.exams.ai.title")} value={source} onChange={setSource} options={[{ value: "topic", label: t("teach.exams.ai.sourceTopic") }, { value: "doc", label: t("teach.exams.ai.sourceDoc") }]} />
        {source === "topic" ? (
          <Textarea label={t("teach.exams.ai.topic")} placeholder={t("teach.exams.ai.topicHint")} value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={500} />
        ) : docs.error && !docs.data ? (
          <Button size="sm" variant="secondary" onClick={docs.reload}>
            {t("common.retry")}
          </Button>
        ) : docs.data && docs.data.length === 0 ? (
          <p className="um-muted">{t("teach.exams.ai.noDocs")}</p>
        ) : (
          <Select label={t("teach.exams.ai.doc")} value={doc} onChange={(e) => setDoc(e.target.value)} disabled={docs.loading && !docs.data}>
            <option value="" />
            {(docs.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </Select>
        )}
        <p className="um-label">{t("teach.exams.ai.choice")}</p>
        <Chips label={t("teach.exams.ai.choice")} value={choice} onChange={setChoice} options={CHOICE_COUNTS.map((v) => ({ value: v, label: v }))} />
        <p className="um-label">{t("teach.exams.ai.open")}</p>
        <Chips label={t("teach.exams.ai.open")} value={open} onChange={setOpen} options={OPEN_COUNTS.map((v) => ({ value: v, label: v }))} />
        <p className="um-label">{t("teach.exams.ai.difficulty")}</p>
        <Chips label={t("teach.exams.ai.difficulty")} value={difficulty} onChange={setDifficulty} options={EXAM_DIFFICULTIES.map((v) => ({ value: v, label: t(`teach.exams.ai.${v}`) }))} />
        <p className="um-muted">{t("teach.exams.ai.hint")}</p>
        {error ? <EdgeNotice error={error} /> : null}
        <Button loading={busy} disabled={!ready || busy} onClick={() => void run()}>
          {t("teach.exams.ai.generate")}
        </Button>
      </div>
    </details>
  );
}
