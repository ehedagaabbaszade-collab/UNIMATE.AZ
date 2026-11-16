"use client";

import { EXAM_LETTERS, ExamQuestionSchema, ExamSchema, MAX_VARIANTS, renderExamVariantsHtml, variantLetter, type Exam, type ExamLabels } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { Button, Dialog, Icon, Input, Textarea, useToast } from "@unimate/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useUser } from "@/components/user";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useAsync } from "@/lib/use-async";
import { Chips } from "../career/parts";
import { AiQuestions } from "./AiQuestions";
import { QuestionBank } from "./QuestionBank";
import { newId, useExamStore } from "./store";

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
  const router = useRouter();
  const { toast } = useToast();
  const { id: uid } = useUser();
  const store = useExamStore(uid);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [variants, setVariants] = useState("1");
  const [bankOpen, setBankOpen] = useState(false);
  const [newExamId] = useState(newId); // stable, so paper and key exports of an unsaved exam shuffle identically
  const isNew = id === "new";
  const uni = useAsync(async () => {
    const sb = getBrowserClient();
    const p = await sb.from("profiles").select("university_id").eq("id", uid).maybeSingle<{ university_id: string | null }>();
    if (!p.data?.university_id) return null;
    const r = await sb.from("universities").select("name").eq("id", p.data.university_id).maybeSingle<{ name: string }>();
    return r.data?.name ?? null;
  }, [uid]);

  useEffect(() => {
    if (!store.ready || loaded) return;
    const e = store.exams.find((x) => x.id === id);
    if (e) setDraft({ title: e.title, subject: e.subject, group: e.group, minutes: String(e.minutes), questions: e.questions.map((q) => ({ ...q, points: String(q.points) })) });
    else if (!isNew) router.replace("/teacher"); // not on this device
    setLoaded(true);
  }, [store.ready, store.exams, loaded, id, isNew, router]);

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const patchQ = (qi: number, p: Partial<QDraft>) => setDraft((d) => ({ ...d, questions: d.questions.map((q, i) => (i === qi ? { ...q, ...p } : q)) }));
  const addQuestion = (kind: "choice" | "open") => setDraft((d) => ({ ...d, questions: [...d.questions, { id: newId(), kind, text: "", options: kind === "choice" ? ["", ""] : [], correct: 0, points: "1" }] }));

  const fail = (msg: string): null => {
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
    const parsed = ExamSchema.safeParse({ id: isNew ? newExamId : id, title: draft.title, subject: draft.subject, group: draft.group, minutes, questions });
    return parsed.success ? parsed.data : fail(t("common.genericError"));
  };

  const save = () => {
    const exam = build();
    if (!exam) return;
    const ok = store.update((s) => (s.some((x) => x.id === exam.id) ? s.map((x) => (x.id === exam.id ? exam : x)) : [exam, ...s]));
    if (!ok) return void fail(t("common.genericError"));
    toast(t("teach.exams.saved"), "success");
    router.push("/teacher");
  };

  const remove = () => {
    const ok = store.update((s) => s.filter((x) => x.id !== id));
    setConfirmDelete(false);
    if (!ok) return void toast(t("common.genericError"), "error");
    router.push("/teacher");
  };

  const labels = (): ExamLabels => ({ subject: t("teach.exams.fSubject"), group: t("teach.exams.fGroup"), fullName: t("teach.exams.print.fullName"), date: t("teach.exams.print.date"), duration: t("teach.exams.print.duration"), minutes: t("teach.exams.print.minutes"), points: t("teach.exams.print.points"), totalPoints: t("teach.exams.print.totalPoints"), answerKey: t("teach.exams.print.answerKey"), openAnswer: t("teach.exams.print.openAnswer"), variant: t("teach.exams.print.variant") });
  /** Web "PDF": the same HTML as mobile in a new window, printed (the browser's print dialog saves it as PDF). */
  function print(key: boolean) {
    const exam = build();
    if (!exam) return;
    const w = window.open("", "_blank");
    if (!w) return toast(t("teach.exams.exportFailed"), "error");
    try {
      w.document.open();
      w.document.write(renderExamVariantsHtml(exam, labels(), Number(variants), { ...(uni.data ? { university: uni.data } : {}), key }));
      w.document.close();
      w.focus();
      w.print();
    } catch {
      toast(t("teach.exams.exportFailed"), "error");
    }
  }

  const total = draft.questions.reduce((n, q) => n + (Number.isFinite(num(q.points)) ? num(q.points) : 0), 0);
  return (
    <div className="stack">
      <header className="page-head">
        <h1>{isNew ? t("teach.exams.new") : t("teach.exams.editTitle")}</h1>
      </header>
      <div className="um-card stack">
        <Input label={t("teach.exams.fTitle")} value={draft.title} onChange={(e) => patch({ title: e.target.value })} maxLength={200} />
        <Input label={t("teach.exams.fSubject")} value={draft.subject} onChange={(e) => patch({ subject: e.target.value })} maxLength={120} />
        <Input label={t("teach.exams.fGroup")} value={draft.group} onChange={(e) => patch({ group: e.target.value })} maxLength={60} />
        <Input label={t("teach.exams.fMinutes")} value={draft.minutes} onChange={(e) => patch({ minutes: e.target.value.replace(/\D/g, "") })} inputMode="numeric" maxLength={3} />
      </div>

      <h2>{t("teach.exams.questions")}</h2>
      {draft.questions.length === 0 ? <p className="um-muted">{t("teach.exams.noQuestions")}</p> : null}
      {draft.questions.map((q, qi) => (
        <div key={q.id} className="um-card stack">
          <div className="row row--between">
            <strong>{`${qi + 1}. ${q.kind === "choice" ? t("teach.exams.kindChoice") : t("teach.exams.kindOpen")}`}</strong>
            <Button size="sm" variant="ghost" aria-label={t("teach.exams.removeQuestion", { n: qi + 1 })} onClick={() => setDraft((d) => ({ ...d, questions: d.questions.filter((x) => x.id !== q.id) }))}>
              {t("common.delete")}
            </Button>
          </div>
          <Textarea label={t("teach.exams.qText", { n: qi + 1 })} value={q.text} onChange={(e) => patchQ(qi, { text: e.target.value })} maxLength={1000} />
          {q.options.map((o, oi) => {
            const letter = EXAM_LETTERS[oi]!;
            const on = q.correct === oi;
            return (
              <div key={oi} className="row">
                <input type="radio" name={`correct-${q.id}`} checked={on} onChange={() => patchQ(qi, { correct: oi })} aria-label={t("teach.exams.markCorrect", { letter })} />
                <div style={{ flex: 1, minWidth: 160 }}>
                  <Input label={t("teach.exams.option", { letter })} value={o} maxLength={300} onChange={(e) => patchQ(qi, { options: q.options.map((x, i) => (i === oi ? e.target.value : x)) })} />
                </div>
                {q.options.length > 2 ? (
                  <Button size="sm" variant="ghost" aria-label={t("teach.exams.removeOption", { letter })} onClick={() => patchQ(qi, { options: q.options.filter((_, i) => i !== oi), correct: q.correct === oi ? 0 : q.correct > oi ? q.correct - 1 : q.correct })}>
                    <Icon name="close" size="sm" />
                  </Button>
                ) : null}
              </div>
            );
          })}
          {q.kind === "choice" && q.options.length < 6 ? (
            <Button size="sm" variant="secondary" onClick={() => patchQ(qi, { options: [...q.options, ""] })}>
              {t("teach.exams.addOption")}
            </Button>
          ) : null}
          <Input label={t("teach.exams.points")} value={q.points} onChange={(e) => patchQ(qi, { points: e.target.value.replace(/[^0-9.,]/g, "") })} inputMode="decimal" maxLength={5} />
        </div>
      ))}
      <div className="row">
        <Button variant="secondary" onClick={() => addQuestion("choice")}>
          {t("teach.exams.addChoice")}
        </Button>
        <Button variant="secondary" onClick={() => addQuestion("open")}>
          {t("teach.exams.addOpen")}
        </Button>
        <Button variant="secondary" onClick={() => setBankOpen(true)}>
          {t("teach.exams.bankOpen")}
        </Button>
      </div>
      <AiQuestions
        subject={draft.subject}
        onQuestions={(qs) => {
          setDraft((d) => ({ ...d, questions: [...d.questions, ...qs.map((q) => ({ ...q, id: newId(), points: String(q.points) }))] }));
          toast(t("teach.exams.ai.added", { n: qs.length }), "success");
        }}
      />
      <Dialog open={bankOpen} onClose={() => setBankOpen(false)} title={t("teach.exams.bank")} actions={<Button variant="secondary" onClick={() => setBankOpen(false)}>{t("common.close")}</Button>}>
        <QuestionBank excludeId={id} onAdd={(q) => setDraft((d) => ({ ...d, questions: [...d.questions, { ...q, id: newId(), options: [...q.options], points: String(q.points) }] }))} />
      </Dialog>
      <p className="um-muted">{`${t("teach.exams.print.totalPoints")}: ${total}`}</p>

      {error ? (
        <p className="err-box" role="alert">
          {error}
        </p>
      ) : null}
      <div className="row">
        <Button onClick={save}>{t("teach.exams.save")}</Button>
      </div>
      <p className="um-label">{t("teach.exams.variants")}</p>
      <Chips label={t("teach.exams.variants")} value={variants} onChange={setVariants} options={Array.from({ length: MAX_VARIANTS }, (_, i) => ({ value: String(i + 1), label: i === 0 ? "A" : `A–${variantLetter(i)}` }))} />
      {variants !== "1" ? <p className="um-muted">{t("teach.exams.variantsHint")}</p> : null}
      <div className="row">
        <Button variant="secondary" onClick={() => print(false)}>
          {t("teach.exams.exportPaper")}
        </Button>
        <Button variant="secondary" onClick={() => print(true)}>
          {t("teach.exams.exportKey")}
        </Button>
        {!isNew ? (
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            {t("teach.exams.deleteExam")}
          </Button>
        ) : null}
      </div>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t("teach.exams.deleteExam")}
        actions={
          <>
            <Button variant="danger" onClick={remove}>
              {t("common.delete")}
            </Button>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              {t("common.cancel")}
            </Button>
          </>
        }
      >
        <p>{t("teach.exams.deleteConfirm")}</p>
      </Dialog>
    </div>
  );
}
