// UNTESTED (no Deno available). Thin adapter: authenticate -> validate body (zod, packages/core) -> interviewQuestions /
// interviewScore in packages/pipeline (tested: guarded route + budget, daily AI quota, user text fenced with wrapUntrusted,
// zod-validated output in the chosen language, cache). Without a configured route it answers 503 ai_not_configured.
//
// POST { mode: "questions", role, level, count?, outputLanguage? } -> 200 { result: { questions[] }, cached }
// POST { mode: "score", role, level, question, answer, outputLanguage? } -> 200 { result: { score, strengths, improvements, improvedAnswer }, cached }
import { interviewQuestions, interviewScore, parseInterviewRequest } from "@unimate/pipeline";
import { authenticate, careerDeps, corsHeaders, errorResponse, json, readBody } from "../_shared/runtime.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  try {
    const userId = await authenticate(req);
    if (!userId) return json(401, { error: "unauthorized" });
    const q = parseInterviewRequest(await readBody(req));
    const deps = careerDeps();
    if (q.mode === "questions") {
      const r = await interviewQuestions(deps, { userId, role: q.role, level: q.level, count: q.count, outputLanguage: q.outputLanguage });
      return json(200, { result: r.output, cached: r.cached });
    }
    const r = await interviewScore(deps, { userId, role: q.role, level: q.level, question: q.question, answer: q.answer, outputLanguage: q.outputLanguage });
    return json(200, { result: r.output, cached: r.cached });
  } catch (e) {
    return errorResponse(e);
  }
});
