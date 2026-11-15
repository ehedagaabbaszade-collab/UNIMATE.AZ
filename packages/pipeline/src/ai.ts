import { computeCost, routeModel, type AiProvider, type AiTask, type ModelTier, type PlanId, type TokenUsage } from "@unimate/core";
import { subRequestId, type GuardedProvider } from "./ai-guard";
import { PipelineError } from "./errors";
import type { Repository } from "./repository";

/** Concrete model names per tier, plus the embedding model. Deployment configuration. */
export interface ModelMap {
  small: string;
  standard: string;
  premium: string;
  embed: string;
}

/** document_chunks.embedding is vector(1536). */
export const EMBEDDING_DIMS = 1536;

export const modelFor = (models: ModelMap, plan: PlanId, task: AiTask): { tier: ModelTier; model: string } => {
  const tier = routeModel(plan, task);
  return { tier, model: models[tier] };
};

/** Writes ai_usage with cost computed by core's computeCost (micro-USD). */
export async function recordUsage(
  repo: Repository,
  userId: string,
  feature: string,
  tier: ModelTier,
  model: string,
  usage: TokenUsage,
): Promise<void> {
  const { usdMicro } = computeCost(tier, usage);
  await repo.recordAiUsage({ userId, feature, model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costMicroUsd: usdMicro });
}

/** Opt-in guarded path: route/budget/rate-limit/fallback/settle all happen inside the GuardedProvider. */
export interface GuardedEmbed {
  guard: GuardedProvider;
  plan: PlanId;
  /** Each batch is a separate billable call: ids are `${requestBase}:embed:${batch}`. */
  requestBase: string;
}

/**
 * Embeds `inputs` in batches, verifies count and dimensions, records usage per batch.
 * With `guarded` usage is recorded by the ledger (settle) and `deps.models` is not used; without it the legacy
 * ModelMap path runs (tests / unconfigured deployments).
 */
export async function embedAll(
  deps: { repo: Repository; provider: AiProvider; models?: ModelMap },
  userId: string,
  inputs: string[],
  batchSize = 64,
  /** Called before each batch (e.g. a job heartbeat). */
  beforeBatch?: () => Promise<void>,
  guarded?: GuardedEmbed,
  /** Retrieval role: "passage" for stored chunks, "query" for a question. */
  inputType?: "query" | "passage",
): Promise<number[][]> {
  const role = inputType ? { inputType } : {};
  const out: number[][] = [];
  for (let i = 0; i < inputs.length; i += batchSize) {
    await beforeBatch?.();
    const batch = inputs.slice(i, i + batchSize);
    let r: { vectors: number[][]; usage: TokenUsage };
    if (guarded) {
      const requestId = subRequestId(guarded.requestBase, `embed:${i / batchSize}`);
      // One rate-limit slot per embedAll operation (the first batch); the budget is still reserved per batch.
      r = await guarded.guard.embed({ userId, plan: guarded.plan, requestId, skipRateLimit: i > 0 }, batch, role);
    } else {
      if (!deps.models) throw new PipelineError("ai_not_configured", "No model map or guard configured", false);
      r = await deps.provider.embed({ model: deps.models.embed, inputs: batch, ...role });
    }
    if (r.vectors.length !== batch.length)
      throw new PipelineError("embed_mismatch", `Embedding count ${r.vectors.length} != inputs ${batch.length}`, true, true);
    for (const v of r.vectors)
      if (v.length !== EMBEDDING_DIMS || !v.every(Number.isFinite))
        throw new PipelineError("embed_dims", `Embedding must have ${EMBEDDING_DIMS} finite dimensions (got ${v.length})`, false, true);
    out.push(...r.vectors);
    if (!guarded) await recordUsage(deps.repo, userId, "embed", "small", deps.models!.embed, r.usage);
  }
  return out;
}
