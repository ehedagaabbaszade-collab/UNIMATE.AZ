import { CvFeedbackResultSchema, InterviewQuestionsResultSchema, InterviewScoreResultSchema, type CvLanguage, type InterviewLevel } from "@unimate/core";
import type { z } from "zod";
import { askResultSchema, callEdge, flashcardsResultSchema, processResponseSchema, importResourceResponseSchema, resourceUrlResponseSchema, quizResultSchema, summaryResultSchema, type EdgeResult } from "./edge";
import { getSupabaseEnv } from "./env";
import { requireSupabase } from "./supabase";

function deps() {
  const env = getSupabaseEnv();
  if (!env) throw new Error("Supabase is not configured");
  return {
    baseUrl: env.url,
    anonKey: env.anonKey,
    getAccessToken: async () => (await requireSupabase().auth.getSession()).data.session?.access_token ?? null,
  };
}

const call = <S extends z.ZodType>(name: Parameters<typeof callEdge>[1], body: Record<string, unknown>, schema: S): Promise<EdgeResult<z.infer<S>>> =>
  callEdge(deps(), name, body, schema);

export const processDocument = (documentId: string) => call("process-document", { documentId }, processResponseSchema);
export const askDocument = (documentId: string, question: string, conversationId?: string) =>
  call("ask-document", { documentId, question, ...(conversationId ? { conversationId } : {}) }, askResultSchema);
export const generateSummary = (documentId: string, kind: "short" | "detailed" | "exam", language?: string) =>
  call("generate-study-material", { documentId, type: "summary", kind, ...(language ? { language } : {}) }, summaryResultSchema);
export const generateQuizMaterial = (documentId: string, count?: number, language?: string) =>
  call("generate-study-material", { documentId, type: "quiz", ...(count ? { count } : {}), ...(language ? { language } : {}) }, quizResultSchema);
export const generateFlashcardMaterial = (documentId: string, count?: number, language?: string) =>
  call("generate-study-material", { documentId, type: "flashcards", ...(count ? { count } : {}), ...(language ? { language } : {}) }, flashcardsResultSchema);
export const importResource = (resourceId: string) => call("import-resource", { resourceId }, importResourceResponseSchema);
export const resourceUrl = (resourceId: string) => call("resource-url", { resourceId }, resourceUrlResponseSchema);
export const cvFeedback = (cvId: string, o: { opportunityId?: string; outputLanguage?: CvLanguage } = {}) =>
  call("cv-feedback", { cvId, ...(o.opportunityId ? { opportunityId: o.opportunityId } : {}), ...(o.outputLanguage ? { outputLanguage: o.outputLanguage } : {}) }, CvFeedbackResultSchema);
export const interviewQuestions = (role: string, level: InterviewLevel, outputLanguage?: CvLanguage, count?: number) =>
  call("interview-prep", { mode: "questions", role, level, ...(outputLanguage ? { outputLanguage } : {}), ...(count ? { count } : {}) }, InterviewQuestionsResultSchema);
export const interviewScore = (role: string, level: InterviewLevel, question: string, answer: string, outputLanguage?: CvLanguage) =>
  call("interview-prep", { mode: "score", role, level, question, answer, ...(outputLanguage ? { outputLanguage } : {}) }, InterviewScoreResultSchema);
