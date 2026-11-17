// Thin adapter: authenticate -> validate (zod, packages/pipeline/writing.ts, tested) -> guarded "chat" route generation
// (budget, rate limit, daily AI quota, zod-validated JSON with one repair). No bibliography is ever generated.
//
// POST { kind: "independent_work"|"report"|"essay"|"presentation", topic, subject?, length?, requirements?, outputLanguage? }
//   -> 200 { kind, result }   (result: DocumentDraft or SlidesDraft)
import { parseWritingRequest, writeAssignment } from "@unimate/pipeline";
import { aiConfig, authenticate, preflight, errorResponse, json, readBody, repository } from "../_shared/runtime.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight(req);
  if (req.method !== "POST") return json(req, 405, { error: "method_not_allowed" });
  try {
    const userId = await authenticate(req);
    if (!userId) return json(req, 401, { error: "unauthorized" });
    const q = parseWritingRequest(await readBody(req));
    const { guard } = aiConfig();
    const r = await writeAssignment({ repo: repository(), guard }, { userId, ...q });
    return json(req, 200, { kind: q.kind, result: r.output });
  } catch (e) {
    return errorResponse(req, e);
  }
});
