// UNTESTED (no Deno available). Thin adapter: authenticate -> askDocument (ownership, atomic daily quota,
// retrieval as the user via match_chunks, fenced prompt, citation validation, persistence).
//
// POST { documentId, question, conversationId? } (user JWT) -> 200 AskResult
// 503 { error: "ai_not_configured" } when no provider key is set; the answer is never faked.
import { askDocument } from "@unimate/pipeline";
import { aiConfig, authenticate, corsHeaders, errorResponse, json, readBody, repository, uuidField } from "../_shared/runtime.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  try {
    const userId = await authenticate(req);
    if (!userId) return json(401, { error: "unauthorized" });
    const body = await readBody(req);
    const documentId = uuidField(body, "documentId");
    const question = typeof body.question === "string" ? body.question : "";
    const conversationId = body.conversationId === undefined ? undefined : uuidField(body, "conversationId");

    const { provider, guard } = aiConfig();
    const result = await askDocument(
      { repo: repository(), provider, guard },
      { userId, documentId, question, ...(conversationId ? { conversationId } : {}) },
    );
    return json(200, result);
  } catch (e) {
    return errorResponse(e);
  }
});
