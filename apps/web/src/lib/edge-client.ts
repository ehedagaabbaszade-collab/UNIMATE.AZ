"use client";

import { z } from "zod";
import { callEdge, askResultSchema, flashcardsResultSchema, processResponseSchema, importResourceResponseSchema, resourceUrlResponseSchema, quizResultSchema, summaryResultSchema, type EdgeResult } from "./edge";
import { getBrowserClient } from "./supabase/browser";
import { BackendNotConfiguredError, getSupabaseEnv } from "./supabase/env";

function deps() {
  const env = getSupabaseEnv();
  if (!env) throw new BackendNotConfiguredError();
  return {
    baseUrl: env.url,
    anonKey: env.anonKey,
    getAccessToken: async () => (await getBrowserClient().auth.getSession()).data.session?.access_token ?? null,
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
