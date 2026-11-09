import { describe, expect, it } from "vitest";
import { isCorrect, parseOptions, scoreQuiz, toQuestionRows, type QuizQuestion } from "./quiz";

const qs: QuizQuestion[] = [
  { id: "a", prompt: "p1", options: ["w", "x", "y", "z"], answer: "y", explanation: null },
  { id: "b", prompt: "p2", options: ["1", "2", "3", "4"], answer: "2", explanation: "because" },
];

describe("quiz scoring", () => {
  it("scores by comparing the chosen option text with the stored answer", () => {
    expect(scoreQuiz(qs, { a: 2, b: 1 })).toEqual({ score: 2, max: 2 });
    expect(scoreQuiz(qs, { a: 0, b: 1 })).toEqual({ score: 1, max: 2 });
    expect(scoreQuiz(qs, {})).toEqual({ score: 0, max: 2 });
  });
  it("ignores out-of-range indexes", () => {
    expect(isCorrect(qs[0]!, 9)).toBe(false);
    expect(isCorrect(qs[0]!, -1)).toBe(false);
  });
  it("score never exceeds max (attempts check: score <= max_score)", () => {
    const r = scoreQuiz(qs, { a: 2, b: 1, zzz: 0 });
    expect(r.score).toBeLessThanOrEqual(r.max);
  });
  it("parses jsonb options defensively", () => {
    expect(parseOptions(["a", 1, "b"])).toEqual(["a", "b"]);
    expect(parseOptions(null)).toEqual([]);
  });
  it("builds question rows with answer text (NOT NULL) and positions", () => {
    const rows = toQuestionRows("q1", [{ prompt: "P", options: ["a", "b", "c", "d"], answer_index: 3, explanation: "" }]);
    expect(rows).toEqual([{ quiz_id: "q1", position: 0, kind: "mcq", prompt: "P", options: ["a", "b", "c", "d"], answer: "d", explanation: null }]);
  });
});
