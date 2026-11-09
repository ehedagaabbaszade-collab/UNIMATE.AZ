export interface QuizQuestion {
  id: string;
  prompt: string;
  options: string[];
  /** The correct option's text (questions.answer). */
  answer: string;
  explanation: string | null;
}

export function parseOptions(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((o): o is string => typeof o === "string") : [];
}

export const isCorrect = (q: QuizQuestion, chosenIndex: number | undefined): boolean =>
  chosenIndex !== undefined && q.options[chosenIndex] !== undefined && q.options[chosenIndex] === q.answer;

/** `answers` maps question id -> chosen option index. Unanswered questions score 0. */
export function scoreQuiz(questions: readonly QuizQuestion[], answers: Readonly<Record<string, number>>): { score: number; max: number } {
  let score = 0;
  for (const q of questions) if (isCorrect(q, answers[q.id])) score++;
  return { score, max: questions.length };
}

export interface GeneratedQuestion {
  prompt: string;
  options: string[];
  answer_index: number;
  explanation: string;
}

/** Rows for public.questions from a generated quiz (answer is stored as the correct option's text; NOT NULL). */
export function toQuestionRows(quizId: string, generated: readonly GeneratedQuestion[]) {
  return generated.map((q, position) => ({
    quiz_id: quizId,
    position,
    kind: "mcq" as const,
    prompt: q.prompt,
    options: q.options,
    answer: q.options[q.answer_index] ?? "",
    explanation: q.explanation || null,
  }));
}
