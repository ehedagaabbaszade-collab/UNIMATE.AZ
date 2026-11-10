import { z } from "zod";

/** A question as the student may see it: no answer key, no explanation (those come back from submit_quiz_attempt). */
export interface QuizQuestion {
  id: string;
  prompt: string;
  options: string[];
}

export function parseOptions(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((o): o is string => typeof o === "string") : [];
}

/** `choices` maps question id -> chosen option index. Only answered questions are sent (the server grades the rest as wrong). */
export function buildAnswers(questions: readonly QuizQuestion[], choices: Readonly<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const q of questions) {
    const c = choices[q.id];
    if (c !== undefined && Number.isInteger(c) && c >= 0 && c < q.options.length) out[q.id] = c;
  }
  return out;
}

/** Shape of public.submit_quiz_attempt's return value. Parsed, never trusted. */
export const submitResultSchema = z.object({
  attempt_id: z.string(),
  score: z.number().int().min(0),
  max_score: z.number().int().min(0),
  ungraded: z.number().int().min(0).default(0),
  xp_awarded: z.number().int().min(0).default(0),
  xp_eligible: z.boolean().default(false),
  duplicate: z.boolean().default(false),
  results: z
    .array(
      z.object({
        question_id: z.string(),
        answered: z.boolean(),
        correct: z.boolean().nullable(),
        correct_answer: z.string().nullable().optional(),
        explanation: z.string().nullable().optional(),
        correct_option: z.number().int().nullable().optional(),
      }),
    )
    .default([]),
});
export type SubmitResult = z.infer<typeof submitResultSchema>;

/** Parses the RPC payload; null when it does not match (the UI shows a generic error instead of a wrong score). */
export function parseSubmitResult(raw: unknown): SubmitResult | null {
  const r = submitResultSchema.safeParse(raw);
  return r.success ? r.data : null;
}

export const attemptCount = (attempts: readonly { quiz_id: string }[], quizId: string): number => attempts.filter((a) => a.quiz_id === quizId).length;
