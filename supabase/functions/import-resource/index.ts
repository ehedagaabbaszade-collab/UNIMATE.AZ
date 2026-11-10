// UNTESTED (no Deno). Thin adapter: authenticate -> importResource (authz as the caller, type/size/path rules, copy into the
// caller's documents folder via service role, atomic monthly quota, idempotent enqueue) -> run the job in the background.
// POST { resourceId } (user JWT) -> 202 { documentId, jobId, created }
import { documentJobRunner, importResource, TesseractOcrEngine } from "@unimate/pipeline";
import { aiConfig, authenticate, corsHeaders, errorResponse, json, ocrLangPath, readBody, repository, storageReader, uuidField } from "../_shared/runtime.ts";
import { importAdapters, resourceReader } from "../_shared/notes.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  try {
    const userId = await authenticate(req);
    if (!userId) return json(401, { error: "unauthorized" });
    const resourceId = uuidField(await readBody(req), "resourceId");
    const repo = repository();
    const { documentId, job, created } = await importResource({ repo, resources: resourceReader, ...importAdapters() }, { userId, resourceId });
    if (created) {
      const { provider, guard } = aiConfig();
      const runner = documentJobRunner(
        { repo, storage: storageReader(), provider, guard, ocr: new TesseractOcrEngine({ ...(ocrLangPath() ? { langPath: ocrLangPath()! } : {}) }) },
        `edge-${crypto.randomUUID()}`,
      );
      const work = runner.runOnce(new Date(), ["extract_text"]).catch((e) => console.error("job run failed", e instanceof Error ? e.name : "unknown"));
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work);
    }
    return json(202, { documentId, jobId: job.id, created });
  } catch (e) {
    return errorResponse(e);
  }
});
