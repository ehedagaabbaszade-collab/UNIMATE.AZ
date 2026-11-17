// Thin adapter: authenticate -> validate (zod, packages/pipeline/exam-questions.ts, tested) -> guarded "chat" route
// generation (budget, rate limit, daily AI quota, zod-validated JSON with one repair). Teacher-only use: the answer key
// is returned because the caller authors the exam. A documentId source must be the caller's own processed document.
//
// POST { topic? | documentId?, subject?, choiceCount 0-20, openCount 0-10, difficulty?, outputLanguage? }
//   -> 200 { questions: [{ kind, text, options, correct, points }] }
import { generateExamQuestions, parseExamGenRequest } from "@unimate/pipeline";
import { aiConfig, authenticate, corsHeaders, errorResponse, json, readBody, repository } from "../_shared/runtime.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  try {
    const userId = await authenticate(req);
    if (!userId) return json(401, { error: "unauthorized" });
    const q = parseExamGenRequest(await readBody(req));
    const { guard } = aiConfig();
    const r = await generateExamQuestions({ repo: repository(), guard }, { userId, ...q });
    return json(200, r.output);
  } catch (e) {
    return errorResponse(e);
  }
});
