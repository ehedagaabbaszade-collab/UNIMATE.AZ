// UNTESTED (no Deno available). Thin adapter: authenticate -> plan feature check + atomic quota + zod-validated
// generation (one repair retry, versioned prompt, cached) in packages/pipeline.
//
// POST { documentId, type: "summary" | "quiz" | "flashcards", kind?: "short"|"detailed"|"exam", count?, outputLanguage?, sourceLanguage? }
// (`language` is a deprecated alias of outputLanguage). outputLanguage defaults to profiles.locale. Quiz responses
// carry { quizId, questions[{id,prompt,options}] } only: the answer key never leaves the server (submit_quiz_attempt grades).
import { generateFlashcards, generateQuiz, generateSummary, parseGenerateRequest } from "@unimate/pipeline";
import { aiConfig, authenticate, corsHeaders, errorResponse, json, readBody, repository } from "../_shared/runtime.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  try {
    const userId = await authenticate(req);
    if (!userId) return json(401, { error: "unauthorized" });
    // zod schema (packages/pipeline, tested): outputLanguage/sourceLanguage are restricted to az/tr/en/ru, kind/type/count are validated.
    const q = parseGenerateRequest(await readBody(req));
    const outputLanguage = q.outputLanguage ?? q.language;
    const langs = { ...(outputLanguage ? { outputLanguage } : {}), ...(q.sourceLanguage ? { sourceLanguage: q.sourceLanguage } : {}) };
    const common = { userId, documentId: q.documentId, ...langs, ...(q.count ? { count: q.count } : {}) };

    const { provider, guard } = aiConfig();
    const deps = { repo: repository(), provider, guard };

    switch (q.type) {
      case "summary":
        return json(200, await generateSummary(deps, { userId, documentId: q.documentId, kind: q.kind, ...langs }));
      case "quiz":
        return json(200, await generateQuiz(deps, common));
      case "flashcards":
        return json(200, await generateFlashcards(deps, common));
    }
  } catch (e) {
    return errorResponse(e);
  }
});
