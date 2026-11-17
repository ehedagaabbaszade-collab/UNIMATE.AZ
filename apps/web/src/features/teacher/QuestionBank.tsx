"use client";

import { questionBank, type ExamQuestion } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { Badge, Icon, Input } from "@unimate/ui";
import { useMemo, useState } from "react";
import { useUser } from "@/components/user";
import { useExamStore } from "./store";

const fold = (s: string) => s.toLocaleLowerCase("az").normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i");

/** Every question in the teacher's saved exams (other than `excludeId`), searchable. With `onAdd` (editor) a click copies one in; without it (/teacher/bank) it just browses. */
export function QuestionBank({ excludeId = "", onAdd }: { excludeId?: string; onAdd?: (q: ExamQuestion) => void }) {
  const { t } = useI18n();
  const { id: uid } = useUser();
  const { exams } = useExamStore(uid);
  const [q, setQ] = useState("");
  const [added, setAdded] = useState<Set<string>>(new Set());
  const sections = useMemo(() => {
    const needle = fold(q.trim());
    const by = new Map<string, { title: string; data: ReturnType<typeof questionBank> }>();
    for (const b of questionBank(exams, excludeId)) {
      if (needle && !fold(`${b.question.text} ${b.question.options.join(" ")} ${b.subject}`).includes(needle)) continue;
      const s = by.get(b.examId) ?? { title: b.subject ? `${b.examTitle} · ${b.subject}` : b.examTitle, data: [] };
      s.data.push(b);
      by.set(b.examId, s);
    }
    return [...by.values()];
  }, [exams, excludeId, q]);

  return (
    <div className="stack">
      <Input label={t("teach.exams.bankSearch")} placeholder={t("teach.exams.bankSearch")} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      {sections.length === 0 ? <p className="um-muted">{t("teach.exams.bankEmpty")}</p> : null}
      {sections.map((s) => (
        <section key={s.title} className="stack">
          <h3>{s.title}</h3>
          {s.data.map((item) => {
            const key = `${item.examId}:${item.question.id}`;
            const done = added.has(key);
            const body = (
              <>
                <span className="list-item__main">
                  <span className="list-item__title">{item.question.text}</span>
                  <span className="row">
                    <Badge>{item.question.kind === "choice" ? t("teach.exams.kindChoice") : t("teach.exams.kindOpen")}</Badge>
                    <Badge>{`${item.question.points} ${t("teach.exams.print.points")}`}</Badge>
                  </span>
                </span>
                {onAdd ? <Icon name={done ? "check" : "add"} size="sm" /> : null}
              </>
            );
            return onAdd ? (
              <button
                key={key}
                type="button"
                className="list-item"
                style={{ textAlign: "start", width: "100%", cursor: "pointer" }}
                aria-label={`${item.question.text}${done ? `, ${t("teach.exams.bankAdded")}` : ""}`}
                onClick={() => {
                  onAdd(item.question);
                  setAdded((a) => new Set(a).add(key));
                }}
              >
                {body}
              </button>
            ) : (
              <div key={key} className="list-item">
                {body}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
