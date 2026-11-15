import { z } from "zod";

export const EXAM_LETTERS = "ABCDEF";

export const ExamQuestionSchema = z
  .object({
    id: z.string().min(1).max(40),
    kind: z.enum(["choice", "open"]),
    text: z.string().trim().min(1).max(1000),
    /** Multiple choice: 2-6 options. Open questions keep none. */
    options: z.array(z.string().trim().min(1).max(300)).max(6),
    /** Index into `options` of the single correct answer (ignored for open questions). */
    correct: z.number().int().min(0).max(5),
    points: z.number().min(0).max(100),
  })
  .refine((q) => q.kind === "open" || (q.options.length >= 2 && q.correct < q.options.length));
export const ExamSchema = z.object({
  id: z.string().min(1).max(40),
  title: z.string().trim().min(1).max(200),
  subject: z.string().trim().max(120),
  group: z.string().trim().max(60),
  minutes: z.number().int().min(1).max(600),
  questions: z.array(ExamQuestionSchema).max(100),
});
export const ExamStoreSchema = z.object({ exams: z.array(ExamSchema).max(200) });
export type ExamQuestion = z.infer<typeof ExamQuestionSchema>;
export type Exam = z.infer<typeof ExamSchema>;

export interface ExamLabels {
  subject: string;
  group: string;
  fullName: string;
  date: string;
  duration: string;
  minutes: string;
  points: string;
  totalPoints: string;
  answerKey: string;
  openAnswer: string;
}

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ENTITIES[c]!);

export const examTotalPoints = (e: Exam) => e.questions.reduce((n, q) => n + q.points, 0);

/** A4 exam paper (or, with `key`, the teacher's answer key with the correct option marked). Times New Roman, escaped text only. */
export function renderExamHtml(e: Exam, l: ExamLabels, opts: { university?: string; key?: boolean } = {}): string {
  const key = !!opts.key;
  const qs = e.questions
    .map((q, i) => {
      const opts2 =
        q.kind === "choice"
          ? `<ol class="opts">${q.options.map((o, j) => `<li class="${key && j === q.correct ? "ok" : ""}">${EXAM_LETTERS[j]}) ${esc(o)}${key && j === q.correct ? " ✓" : ""}</li>`).join("")}</ol>`
          : key
            ? ""
            : `<div class="line"></div><div class="line"></div><div class="line"></div>`;
      const note = key && q.kind === "open" ? `<p class="open">${esc(l.openAnswer)}</p>` : "";
      return `<div class="q"><p><b>${i + 1}.</b> ${esc(q.text)} <i>(${q.points} ${esc(l.points)})</i></p>${opts2}${note}</div>`;
    })
    .join("");
  const meta = [e.subject && `${esc(l.subject)}: ${esc(e.subject)}`, e.group && `${esc(l.group)}: ${esc(e.group)}`, `${esc(l.duration)}: ${e.minutes} ${esc(l.minutes)}`].filter(Boolean).join(" &nbsp;|&nbsp; ");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: A4; margin: 2cm; }
body { font-family: "Times New Roman", Times, serif; font-size: 13pt; line-height: 1.4; color: #000; }
h1 { font-size: 16pt; text-align: center; margin: 0 0 4pt; }
.uni { text-align: center; font-weight: bold; margin: 0 0 4pt; }
.meta { text-align: center; margin: 0 0 10pt; }
.who { display: flex; justify-content: space-between; margin: 0 0 14pt; }
.q { margin: 0 0 12pt; page-break-inside: avoid; }
.q p { margin: 0 0 4pt; }
.opts { list-style: none; margin: 0; padding-left: 1cm; }
.ok { font-weight: bold; }
.line { border-bottom: 1px solid #000; height: 20pt; }
.total { text-align: right; margin-top: 12pt; font-weight: bold; }
</style></head><body>
${opts.university ? `<p class="uni">${esc(opts.university)}</p>` : ""}<h1>${esc(e.title)}${key ? ` — ${esc(l.answerKey)}` : ""}</h1>
<p class="meta">${meta}</p>
${key ? "" : `<div class="who"><span>${esc(l.fullName)}: ______________________________</span><span>${esc(l.date)}: ____________</span></div>`}
${qs}
<p class="total">${esc(l.totalPoints)}: ${examTotalPoints(e)}</p>
</body></html>`;
}
