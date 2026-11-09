// UNTESTED (no Deno available). Thin adapter: authenticate -> askDocument (ownership, atomic daily quota,
// retrieval as the user via match_chunks, fenced prompt, citation validation, persistence).
//
// POST { documentId, question, conversationId?, outputLanguage?, sourceLanguage? } (user JWT; az/tr/en/ru, validated by parseAskRequest) -> 200 AskResult
// 503 { error: "ai_not_configured" } when no provider key is set; the answer is never faked.
import { askDocument, parseAskRequest } from "@unimate/pipeline";
import { aiConfig, authenticate, corsHeaders, errorResponse, json, readBody, repository } from "../_shared/runtime.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  try {
    const userId = await authenticate(req);
    if (!userId) return json(401, { error: "unauthorized" });
    const body = parseAskRequest(await readBody(req));

    const { provider, guard } = aiConfig();
    const result = await askDocument(
      { repo: repository(), provider, guard },
      {
        userId,
        documentId: body.documentId,
        question: body.question,
        ...(body.conversationId ? { conversationId: body.conversationId } : {}),
        ...(body.outputLanguage ? { outputLanguage: body.outputLanguage } : {}),
        ...(body.sourceLanguage ? { sourceLanguage: body.sourceLanguage } : {}),
      },
    );
    return json(200, result);
  } catch (e) {
    return errorResponse(e);
  }
});
