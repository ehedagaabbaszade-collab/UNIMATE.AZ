// UNTESTED (no Deno available). Thin adapter: authenticate -> validate body (zod, packages/core) -> cvFeedback in
// packages/pipeline (tested: guarded route + budget reserve/settle, daily AI quota, CV fenced with wrapUntrusted,
// zod-validated output in the chosen language, content-hash cache). Without a configured route it answers 503 ai_not_configured.
//
// POST { cvId, opportunityId?, outputLanguage? } -> 200 { feedback, cached }
import { cvFeedback, parseCvFeedbackRequest } from "@unimate/pipeline";
import { authenticate, careerDeps, corsHeaders, errorResponse, json, readBody } from "../_shared/runtime.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  try {
    const userId = await authenticate(req);
    if (!userId) return json(401, { error: "unauthorized" });
    const q = parseCvFeedbackRequest(await readBody(req));
    const r = await cvFeedback(careerDeps(), { userId, cvId: q.cvId, opportunityId: q.opportunityId, outputLanguage: q.outputLanguage });
    return json(200, { feedback: r.output, cached: r.cached });
  } catch (e) {
    return errorResponse(e);
  }
});
