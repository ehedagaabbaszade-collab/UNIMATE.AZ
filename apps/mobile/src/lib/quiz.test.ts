import { describe, expect, it } from "vitest";
import { quizResultSchema } from "./edge";
import { attemptCount, buildAnswers, parseOptions, parseSubmitResult, type QuizQuestion } from "./quiz";

const qs: QuizQuestion[] = [
  { id: "a", prompt: "p1", options: ["w", "x", "y", "z"] },
  { id: "b", prompt: "p2", options: ["1", "2", "3", "4"] },
];

describe("quiz answers (graded on the server only)", () => {
  it("sends only answered, in-range choices", () => {
    expect(buildAnswers(qs, { a: 2, b: 1 })).toEqual({ a: 2, b: 1 });
    expect(buildAnswers(qs, { a: 2 })).toEqual({ a: 2 });
    expect(buildAnswers(qs, {})).toEqual({});
  });
  it("drops out-of-range, fractional and unknown-question choices", () => {
    expect(buildAnswers(qs, { a: 9, b: -1, zzz: 0 })).toEqual({});
    expect(buildAnswers(qs, { a: 1.5 })).toEqual({});
  });
  it("question objects carry no answer key", () => {
    expect(Object.keys(qs[0]!).sort()).toEqual(["id", "options", "prompt"]);
  });
  it("parses jsonb options defensively", () => {
    expect(parseOptions(["a", 1, "b"])).toEqual(["a", "b"]);
    expect(parseOptions(null)).toEqual([]);
  });
  it("counts attempts per quiz", () => {
    expect(attemptCount([{ quiz_id: "x" }, { quiz_id: "y" }, { quiz_id: "x" }], "x")).toBe(2);
  });
});

describe("submit_quiz_attempt result", () => {
  const good = {
    attempt_id: "9d1f", quiz_id: "q", score: 2, max_score: 3, ungraded: 0, xp_awarded: 21, xp_eligible: true, duplicate: false,
    results: [
      { question_id: "a", answered: true, correct: true, correct_answer: "y", explanation: "because", correct_option: 2 },
      { question_id: "b", answered: false, correct: false, correct_answer: "2", explanation: null, correct_option: 1 },
    ],
  };
  it("accepts the server shape and keeps server-provided score/xp/explanations", () => {
    const r = parseSubmitResult(good)!;
    expect(r).toMatchObject({ score: 2, max_score: 3, xp_awarded: 21, xp_eligible: true });
    expect(r.results[0]).toMatchObject({ correct: true, explanation: "because", correct_option: 2 });
  });
  it("defaults optional fields and rejects malformed payloads", () => {
    expect(parseSubmitResult({ attempt_id: "x", score: 0, max_score: 1 })).toMatchObject({ xp_awarded: 0, xp_eligible: false, results: [] });
    expect(parseSubmitResult(null)).toBeNull();
    expect(parseSubmitResult({ attempt_id: "x", score: "3", max_score: 1 })).toBeNull();
    expect(parseSubmitResult({ ...good, score: -1 })).toBeNull();
  });
});

describe("generate-study-material quiz response", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  it("accepts the server-persisted quiz id with key-less questions", () => {
    const r = quizResultSchema.safeParse({ output: { quizId: id, outputLanguage: "az", questions: [{ id, prompt: "P", options: ["a", "b", "c", "d"] }] }, cached: false, promptVersion: 1, truncated: false });
    expect(r.success).toBe(true);
    expect(r.success && r.data.output.quizId).toBe(id);
  });
  it("rejects the old client-persisted shape (answer_index, no quizId)", () => {
    const r = quizResultSchema.safeParse({ output: { questions: [{ prompt: "P", options: ["a", "b", "c", "d"], answer_index: 1, explanation: "" }] }, cached: false, promptVersion: 1 });
    expect(r.success).toBe(false);
  });
});
