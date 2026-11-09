// UNTESTED (no Deno available). Thin adapter: authenticate -> submitDocument (ownership + atomic monthly quota +
// idempotent enqueue) -> run the job in the background. All logic is in packages/pipeline.
//
// POST { documentId }                      (user JWT)  -> 202 { jobId, created }
// POST { action: "work" } + x-worker-secret (cron)      -> recovers stuck jobs, runs ONE queued job per invocation
//   (a single job stays well inside the stale-lock window; cron calls again for the next one)
import { documentJobRunner, submitDocument, TesseractOcrEngine } from "@unimate/pipeline";
import { aiConfig, authenticate, corsHeaders, errorResponse, json, ocrLangPath, readBody, repository, safeEqual, storageReader, uuidField } from "../_shared/runtime.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const makeRunner = () => {
  const { provider, guard } = aiConfig();
  return documentJobRunner(
    { repo: repository(), storage: storageReader(), provider, guard, ocr: new TesseractOcrEngine({ ...(ocrLangPath() ? { langPath: ocrLangPath()! } : {}) }) },
    `edge-${crypto.randomUUID()}`,
  );
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  try {
    const body = await readBody(req);

    if (body.action === "work") {
      const secret = Deno.env.get("WORKER_SECRET");
      if (!secret || !safeEqual(req.headers.get("x-worker-secret") ?? "", secret)) return json(401, { error: "unauthorized" });
      const runner = makeRunner();
      const recovered = await runner.recoverStuck(new Date());
      const r = await runner.runOnce(new Date());
      return json(200, { recovered: recovered.length, results: r.status === "idle" ? [] : [r.status] });
    }

    const userId = await authenticate(req);
    if (!userId) return json(401, { error: "unauthorized" });
    const documentId = uuidField(body, "documentId");

    const { job, created } = await submitDocument({ repo: repository() }, { documentId, userId });
    if (created) {
      const work = makeRunner().runOnce(new Date(), ["extract_text"]).catch((e) => console.error("job run failed", e instanceof Error ? e.name : "unknown"));
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work);
    }
    return json(202, { jobId: job.id, created });
  } catch (e) {
    return errorResponse(e);
  }
});
