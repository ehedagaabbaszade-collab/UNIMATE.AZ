import { describe, expect, it } from "vitest";
import { renderExamHtml, type Exam, type ExamLabels } from "./exam";

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
