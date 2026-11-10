import { z } from "zod";
import { CV_LANGUAGES, CV_SECTIONS } from "./career";

// Request/response contracts of the cv-feedback and interview-prep edge functions. Shared by the pipeline (validates what
// the model returns) and the apps (validates what the server returns). Nothing here calls a model.

export const INTERVIEW_LEVELS = ["intern", "junior", "mid"] as const;
export type InterviewLevel = (typeof INTERVIEW_LEVELS)[number];
export const INTERVIEW_CATEGORIES = ["behavioral", "technical", "situational", "motivation", "other"] as const;
export const INTERVIEW_ROLE_MAX = 100;
export const INTERVIEW_ANSWER_MAX = 3000;
export const INTERVIEW_COUNT_MAX = 10;

const lang = z.enum(CV_LANGUAGES);
const uuid = z.string().uuid();

export const CvFeedbackRequestSchema = z.object({
  cvId: uuid,
  /** Optional: tailor the feedback to a published listing (title + required skills). */
  opportunityId: uuid.optional(),
  outputLanguage: lang.optional(),
});
export type CvFeedbackRequest = z.infer<typeof CvFeedbackRequestSchema>;

export const InterviewQuestionsRequestSchema = z.object({
  mode: z.literal("questions"),
  role: z.string().trim().min(2).max(INTERVIEW_ROLE_MAX),
  level: z.enum(INTERVIEW_LEVELS),
  count: z.number().int().min(3).max(INTERVIEW_COUNT_MAX).optional(),
  outputLanguage: lang.optional(),
});
export const InterviewScoreRequestSchema = z.object({
  mode: z.literal("score"),
  role: z.string().trim().min(2).max(INTERVIEW_ROLE_MAX),
  level: z.enum(INTERVIEW_LEVELS),
  question: z.string().trim().min(5).max(500),
  answer: z.string().trim().min(10).max(INTERVIEW_ANSWER_MAX),
  outputLanguage: lang.optional(),
});
export const InterviewRequestSchema = z.discriminatedUnion("mode", [InterviewQuestionsRequestSchema, InterviewScoreRequestSchema]);
export type InterviewRequest = z.infer<typeof InterviewRequestSchema>;

export const CvFeedbackSchema = z.object({
  overall: z.string().min(1).max(1200),
  strengths: z.array(z.string().min(1).max(400)).min(1).max(8),
  improvements: z
    .array(z.object({ section: z.enum([...CV_SECTIONS, "general"]), suggestion: z.string().min(1).max(600) }))
    .min(1)
    .max(12),
  missingKeywords: z.array(z.string().min(1).max(60)).max(15).default([]),
  rewrittenSummary: z.string().max(1500).default(""),
});
export type CvFeedback = z.infer<typeof CvFeedbackSchema>;

export const InterviewQuestionsSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().min(5).max(500),
        category: z.enum(INTERVIEW_CATEGORIES).catch("other"),
        tips: z.string().min(1).max(1200),
      }),
    )
    .min(1)
    .max(INTERVIEW_COUNT_MAX),
});
export type InterviewQuestions = z.infer<typeof InterviewQuestionsSchema>;

export const InterviewScoreSchema = z.object({
  score: z.number().int().min(1).max(10),
  strengths: z.array(z.string().min(1).max(400)).max(5).default([]),
  improvements: z.array(z.string().min(1).max(400)).min(1).max(5),
  improvedAnswer: z.string().min(1).max(2000),
});
export type InterviewScore = z.infer<typeof InterviewScoreSchema>;

/** What the edge functions answer (the pipeline adds cache info). */
export const CvFeedbackResultSchema = z.object({ feedback: CvFeedbackSchema, cached: z.boolean() });
export const InterviewQuestionsResultSchema = z.object({ result: InterviewQuestionsSchema, cached: z.boolean() });
export const InterviewScoreResultSchema = z.object({ result: InterviewScoreSchema, cached: z.boolean() });
