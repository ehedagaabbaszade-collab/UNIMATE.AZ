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
  /** "Variant" heading word; only used when printing more than one variant. */
  variant?: string;
}

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ENTITIES[c]!);

export const examTotalPoints = (e: Exam) => e.questions.reduce((n, q) => n + q.points, 0);

/** Deterministic PRNG (mulberry32 over a string hash): the same exam + variant always prints the same paper. */
function seeded(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(xs: readonly T[], r: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export const MAX_VARIANTS = 4;
export const variantLetter = (index: number) => EXAM_LETTERS[index] ?? String(index + 1);

/**
 * Variant `index` of an exam: 0 (A) is the exam as written; B, C, ... shuffle the question order and each multiple-choice
 * question's options, with `correct` remapped so every variant's answer key still marks the same option text.
 */
export function examVariant(e: Exam, index: number): Exam {
  if (index <= 0) return e;
  const r = seeded(`${e.id}:${index}`);
  const questions = shuffle(e.questions, r).map((q) => {
    if (q.kind !== "choice") return q;
    const order = shuffle(q.options.map((_, i) => i), r);
    return { ...q, options: order.map((i) => q.options[i]!), correct: order.indexOf(q.correct) };
  });
  return { ...e, questions };
}

const HEAD = `<!doctype html><html><head><meta charset="utf-8"><style>
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
.variant + .variant { page-break-before: always; }
</style></head><body>
`;
function examBody(e: Exam, l: ExamLabels, opts: { university?: string; key?: boolean; variant?: string }): string {
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
  const meta = [opts.variant && `${esc(l.variant ?? "Variant")}: ${esc(opts.variant)}`, e.subject && `${esc(l.subject)}: ${esc(e.subject)}`, e.group && `${esc(l.group)}: ${esc(e.group)}`, `${esc(l.duration)}: ${e.minutes} ${esc(l.minutes)}`].filter(Boolean).join(" &nbsp;|&nbsp; ");
  return `${opts.university ? `<p class="uni">${esc(opts.university)}</p>` : ""}<h1>${esc(e.title)}${key ? ` — ${esc(l.answerKey)}` : ""}</h1>
<p class="meta">${meta}</p>
${key ? "" : `<div class="who"><span>${esc(l.fullName)}: ______________________________</span><span>${esc(l.date)}: ____________</span></div>`}
${qs}
<p class="total">${esc(l.totalPoints)}: ${examTotalPoints(e)}</p>`;
}
/** A4 exam paper (or, with `key`, the teacher's answer key with the correct option marked). Times New Roman, escaped text only. */
export function renderExamHtml(e: Exam, l: ExamLabels, opts: { university?: string; key?: boolean } = {}): string {
  return `${HEAD}${examBody(e, l, opts)}
</body></html>`;
}

/** `count` variants (A, B, ...) in one PDF, each starting on a new page; with `key`, their answer keys. */
export function renderExamVariantsHtml(e: Exam, l: ExamLabels, count: number, opts: { university?: string; key?: boolean } = {}): string {
  const n = Math.min(Math.max(1, Math.floor(count)), MAX_VARIANTS);
  if (n === 1) return renderExamHtml(e, l, opts);
  const pages = Array.from({ length: n }, (_, i) => `<section class="variant">${examBody(examVariant(e, i), l, { ...opts, variant: variantLetter(i) })}</section>`);
  return `${HEAD}${pages.join("")}
</body></html>`;
}


export interface BankEntry {
  examId: string;
  examTitle: string;
  subject: string;
  question: ExamQuestion;
}
/**
 * Question bank: a view over the exams already saved (no separate store), in saved order, without the exam being
 * edited. A question reused across exams (same kind, text, options and key) is listed once.
 */
export function questionBank(exams: readonly Exam[], exclude?: string): BankEntry[] {
  const seen = new Set<string>();
  const out: BankEntry[] = [];
  for (const e of exams) {
    if (e.id === exclude) continue;
    for (const q of e.questions) {
      const sig = JSON.stringify([q.kind, q.text.trim().toLowerCase(), q.options, q.kind === "choice" ? q.correct : 0]);
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push({ examId: e.id, examTitle: e.title, subject: e.subject, question: q });
    }
  }
  return out;
}

// ------------------------------------------------------------------ AI question generation (teacher)
export const EXAM_DIFFICULTIES = ["easy", "medium", "hard"] as const;
/** Request for AI-drafted exam questions: from a topic, or from one of the teacher's own processed documents. */
export const ExamGenRequestSchema = z
  .object({
    topic: z.string().trim().min(3).max(500).optional(),
    documentId: z.string().uuid().optional(),
    subject: z.string().trim().max(120).optional(),
    choiceCount: z.number().int().min(0).max(20),
    openCount: z.number().int().min(0).max(10),
    difficulty: z.enum(EXAM_DIFFICULTIES).default("medium"),
    outputLanguage: z.enum(["az", "tr", "en", "ru"]).optional(),
  })
  .refine((r) => !!r.topic || !!r.documentId, { message: "topic or documentId is required" })
  .refine((r) => r.choiceCount + r.openCount >= 1, { message: "ask for at least one question" });
export type ExamGenRequest = z.input<typeof ExamGenRequestSchema>;

/** One AI-drafted question: an ExamQuestion without the id (the app assigns ids). The key is the teacher's own. */
export const GeneratedQuestionSchema = z
  .object({
    kind: z.enum(["choice", "open"]),
    text: z.string().trim().min(1).max(1000),
    options: z.array(z.string().trim().min(1).max(300)).max(6),
    correct: z.number().int().min(0).max(5),
    points: z.number().min(0).max(100),
  })
  .refine((q) => (q.kind === "open" ? q.options.length === 0 : q.options.length >= 2 && q.correct < q.options.length), { message: "choice needs 2-6 options and a valid key; open has none" });
export const ExamGenResultSchema = z.object({ questions: z.array(GeneratedQuestionSchema).min(1).max(30) });
export type ExamGenResult = z.infer<typeof ExamGenResultSchema>;

// ------------------------------------------------------------------ lenient reading of model output
type GeneratedQuestion = z.infer<typeof GeneratedQuestionSchema>;
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "").trim();
/** "A) text", "b. text", "C - text" -> "text". */
const stripLetter = (s: string) => s.replace(/^\s*[A-Fa-f]\s*[).:\-–]\s+/, "").trim();
function optionList(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v as Record<string, unknown>) : [];
  return arr
    .map((o) => stripLetter(o && typeof o === "object" ? str((o as Record<string, unknown>).text ?? (o as Record<string, unknown>).label ?? (o as Record<string, unknown>).option) : str(o)))
    .filter(Boolean)
    .map((o) => o.slice(0, 300))
    .slice(0, 6);
}
function correctIndex(v: unknown, options: string[]): number {
  const s = str(v);
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n === options.length ? n - 1 : n; // one past the end can only be a 1-based index of the last option
  }
  if (/^[A-Fa-f]$/.test(s)) return EXAM_LETTERS.indexOf(s.toUpperCase());
  const want = stripLetter(s).toLowerCase();
  return want ? options.findIndex((o) => o.toLowerCase() === want) : -1;
}

/**
 * Reads one AI-drafted question tolerantly: synonym keys (question/prompt, choices/answers, answer/answer_index),
 * letter or option-text keys, "A) " prefixes on options, missing points. Returns null when it still is not a usable
 * question, so one bad item is dropped instead of failing the whole batch.
 */
export function normalizeGeneratedQuestion(raw: unknown): GeneratedQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const q = raw as Record<string, unknown>;
  const text = str(q.text ?? q.question ?? q.prompt ?? q.stem).slice(0, 1000);
  if (!text) return null;
  const options = optionList(q.options ?? q.choices ?? q.answers ?? q.variants);
  const k = str(q.kind ?? q.type).toLowerCase();
  const kind: "choice" | "open" = /open|essay|written|short|açıq|acıq|открыт/.test(k) ? "open" : /choice|mcq|multiple|test|closed/.test(k) ? "choice" : options.length >= 2 ? "choice" : "open";
  const pts = Number(q.points ?? q.score ?? q.marks);
  const points = Number.isFinite(pts) && pts >= 0 && pts <= 100 ? pts : kind === "choice" ? 1 : 4;
  const candidate =
    kind === "open"
      ? { kind, text, options: [], correct: 0, points }
      : { kind, text, options, correct: correctIndex(q.correct ?? q.answer ?? q.answer_index ?? q.correct_index ?? q.correctAnswer ?? q.correct_answer, options), points };
  const r = GeneratedQuestionSchema.safeParse(candidate);
  return r.success ? r.data : null;
}

/** Accepts {questions: [...]}, any single array property, or a bare array; items are checked one by one later. */
export const ExamGenRawSchema = z.preprocess(
  (v) => (Array.isArray(v) ? { questions: v } : v && typeof v === "object" && !Array.isArray((v as { questions?: unknown }).questions) ? { questions: Object.values(v as object).find(Array.isArray) } : v),
  z.object({ questions: z.array(z.unknown()).min(1).max(60) }),
);
