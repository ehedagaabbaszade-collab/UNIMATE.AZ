import type { z } from "zod";
import { askResultSchema, callEdge, flashcardsResultSchema, processResponseSchema, quizResultSchema, summaryResultSchema, type EdgeResult } from "./edge";
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
