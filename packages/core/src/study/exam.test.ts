import { describe, expect, it } from "vitest";
import { examVariant, questionBank, renderExamHtml, renderExamVariantsHtml, type Exam, type ExamLabels } from "./exam";

const l: ExamLabels = { subject: "Subject", group: "Group", fullName: "Name", date: "Date", duration: "Duration", minutes: "min", points: "pts", totalPoints: "Total", answerKey: "Key", openAnswer: "Open" };
const exam: Exam = {
  id: "e1",
  title: "Mid <b>term</b>",
  subject: "Math",
  group: "A1",
  minutes: 45,
  questions: [
    { id: "q1", kind: "choice", text: "2 < 3 & \"x\"?", options: ["no", "yes"], correct: 1, points: 2 },
    { id: "q2", kind: "open", text: "Explain", options: [], correct: 0, points: 3 },
  ],
};

describe("renderExamHtml", () => {
  it("escapes user text", () => {
    const h = renderExamHtml(exam, l);
    expect(h).toContain("Mid &lt;b&gt;term&lt;/b&gt;");
    expect(h).toContain("2 &lt; 3 &amp; &quot;x&quot;?");
    expect(h).not.toContain("<b>term");
    expect(h).toContain("Total: 5");
  });
  it("answer key marks only the correct option", () => {
    const h = renderExamHtml(exam, l, { key: true });
    expect(h).toContain('<li class="ok">B) yes ✓</li>');
    expect(h).toContain('<li class="">A) no</li>');
    expect(renderExamHtml(exam, l)).not.toContain("✓");
  });
});

describe("exam variants", () => {
  const big: Exam = {
    ...exam,
    questions: Array.from({ length: 8 }, (_, i) => ({ id: `q${i}`, kind: "choice" as const, text: `Q${i}`, options: ["a", "b", "c", "d"].map((o) => `${o}${i}`), correct: i % 4, points: 1 })),
  };
  const keyText = (e: Exam) => Object.fromEntries(e.questions.map((q) => [q.id, q.options[q.correct]]));
  it("A is the exam as written; B..D are reshuffled but deterministic", () => {
    expect(examVariant(big, 0)).toBe(big);
    const b = examVariant(big, 1);
    expect(examVariant(big, 1)).toEqual(b);
    expect(b.questions.map((q) => q.id)).not.toEqual(big.questions.map((q) => q.id));
    expect(examVariant(big, 2)).not.toEqual(b);
  });
  it("every variant's key still points at the same option text, and keeps every option", () => {
    for (let v = 1; v < 4; v++) {
      const x = examVariant(big, v);
      expect(keyText(x)).toEqual(keyText(big));
      for (const q of x.questions) expect([...q.options].sort()).toEqual([...big.questions.find((o) => o.id === q.id)!.options].sort());
    }
  });
  it("open questions keep no options; prints one page per variant", () => {
    expect(examVariant(exam, 1).questions.find((q) => q.kind === "open")!.options).toEqual([]);
    const h = renderExamVariantsHtml(big, { ...l, variant: "Variant" }, 3);
    expect(h.match(/class="variant"/g)).toHaveLength(3);
    expect(h).toContain("Variant: C");
    expect(renderExamVariantsHtml(big, l, 1)).toBe(renderExamHtml(big, l));
  });
});

describe("questionBank", () => {
  it("lists questions of other exams once, skipping the exam being edited", () => {
    const other: Exam = { ...exam, id: "e2", title: "Final", questions: [exam.questions[0]!, { id: "q9", kind: "open", text: "New", options: [], correct: 0, points: 1 }] };
    const dup: Exam = { ...exam, id: "e3", questions: [{ ...exam.questions[0]!, id: "zz", text: " 2 < 3 & \"X\"? " }] };
    const bank = questionBank([exam, other, dup], "e1");
    expect(bank.map((b) => b.question.id)).toEqual(["q1", "q9"]);
    expect(bank[0]!.examTitle).toBe("Final");
  });
});
