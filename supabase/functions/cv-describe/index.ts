// UNTESTED (no Deno available). Thin adapter, same shape as cv-feedback: authenticate -> validate body (zod, packages/core) ->
// cvDescribe in packages/pipeline (tested: guarded route, budget reserve/settle, daily AI quota, data fenced with wrapUntrusted).
// Reuses the cv_feedback route/quota. Without a configured route it answers 503 ai_not_configured.
//
// POST { kind, language, context, current? } -> 200 { text }
import { cvDescribe, parseCvDescribeRequest } from "@unimate/pipeline";
import { authenticate, careerDeps, corsHeaders, errorResponse, json, readBody } from "../_shared/runtime.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  try {
    const userId = await authenticate(req);
    if (!userId) return json(401, { error: "unauthorized" });
    const request = parseCvDescribeRequest(await readBody(req));
    const r = await cvDescribe(careerDeps(), { userId, request });
    return json(200, { text: r.output.text });
  } catch (e) {
    return errorResponse(e);
  }
});
