import { computeCost, routeModel, type AiProvider, type AiTask, type ModelTier, type PlanId, type TokenUsage } from "@unimate/core";
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

/** Embeds `inputs` in batches, verifies count and dimensions, records usage per batch. */
export async function embedAll(
  deps: { repo: Repository; provider: AiProvider; models: ModelMap },
  userId: string,
  inputs: string[],
  batchSize = 64,
  /** Called before each batch (e.g. a job heartbeat). */
  beforeBatch?: () => Promise<void>,
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < inputs.length; i += batchSize) {
    await beforeBatch?.();
    const batch = inputs.slice(i, i + batchSize);
    const r = await deps.provider.embed({ model: deps.models.embed, inputs: batch });
    if (r.vectors.length !== batch.length)
      throw new PipelineError("embed_mismatch", `Embedding count ${r.vectors.length} != inputs ${batch.length}`, true, true);
    for (const v of r.vectors)
      if (v.length !== EMBEDDING_DIMS || !v.every(Number.isFinite))
        throw new PipelineError("embed_dims", `Embedding must have ${EMBEDDING_DIMS} finite dimensions (got ${v.length})`, false, true);
    out.push(...r.vectors);
    await recordUsage(deps.repo, userId, "embed", "small", deps.models.embed, r.usage);
  }
  return out;
}
