import type { PlanId } from "../billing/entitlements";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Prompt tokens served from the provider's cache (billed at the cached price). Adapters leave it unset when unknown. */
  cachedInputTokens?: number;
}
export type AiTask = "chat" | "summarize" | "quiz" | "flashcards" | "ocr_cleanup" | "embed";
export type ModelTier = "small" | "standard" | "premium";

export interface GenerateRequest {
  task: AiTask;
  model: string;
  system?: string;
  prompt: string;
  maxOutputTokens?: number;
}
export interface GenerateResult {
  text: string;
  model: string;
  usage: TokenUsage;
}
export interface EmbedRequest {
  model: string;
  inputs: string[];
}
export interface EmbedResult {
  vectors: number[][];
  model: string;
  usage: TokenUsage;
}
export interface AiProvider {
  readonly name: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
  embed(req: EmbedRequest): Promise<EmbedResult>;
}

export class ProviderNotConfiguredError extends Error {
  readonly provider: string;
  constructor(provider: string) {
    super(`AI provider "${provider}" is not configured`);
    this.name = "ProviderNotConfiguredError";
    this.provider = provider;
  }
}

/**
 * LEGACY test/default fixture (tier only, no model names or prices). Production routing and pricing come from the
 * DB-backed AiConfig (see ./config.ts: resolveRoute); nothing in production should read this table.
 * Assumption: paid plans get stronger tiers on reasoning-heavy tasks.
 */
export const MODEL_ROUTING: Record<PlanId, Record<AiTask, ModelTier>> = {
  FREE: { chat: "small", summarize: "small", quiz: "small", flashcards: "small", ocr_cleanup: "small", embed: "small" },
  PLUS: { chat: "standard", summarize: "standard", quiz: "standard", flashcards: "small", ocr_cleanup: "small", embed: "small" },
  PRO: { chat: "premium", summarize: "standard", quiz: "premium", flashcards: "standard", ocr_cleanup: "small", embed: "small" },
  GROUP: { chat: "standard", summarize: "standard", quiz: "standard", flashcards: "standard", ocr_cleanup: "small", embed: "small" },
};

export function routeModel(plan: PlanId, task: AiTask): ModelTier {
  return MODEL_ROUTING[plan][task];
}

export interface TierPrice {
  /** USD per 1M tokens. */
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
}
export type PriceTable = Record<ModelTier, TierPrice>;

/** Placeholder prices; configure per deployment. */
export const DEFAULT_PRICE_TABLE: PriceTable = {
  small: { inputUsdPerMTok: 0.15, outputUsdPerMTok: 0.6 },
  standard: { inputUsdPerMTok: 1, outputUsdPerMTok: 4 },
  premium: { inputUsdPerMTok: 3, outputUsdPerMTok: 15 },
};
/** AZN per USD (AZN is pegged at 1.70). Configurable. */
export const DEFAULT_AZN_PER_USD = 1.7;

export interface Cost {
  /** Integer micro-USD (1e-6 USD). */
  usdMicro: number;
  /** Integer micro-AZN (1e-6 AZN). */
  aznMicro: number;
}

export function computeCost(
  tier: ModelTier,
  usage: TokenUsage,
  table: PriceTable = DEFAULT_PRICE_TABLE,
  aznPerUsd: number = DEFAULT_AZN_PER_USD,
): Cost {
  if (usage.inputTokens < 0 || usage.outputTokens < 0) throw new RangeError("negative token usage");
  const p = table[tier];
  // (USD per MTok) * tokens = micro-USD exactly
  const usdMicro = Math.max(0, Math.ceil(usage.inputTokens * p.inputUsdPerMTok + usage.outputTokens * p.outputUsdPerMTok - 1e-9));
  return { usdMicro, aznMicro: Math.max(0, Math.ceil(usdMicro * aznPerUsd - 1e-9)) };
}

export function sumCosts(costs: Cost[]): Cost {
  return costs.reduce(
    (a, c) => ({ usdMicro: a.usdMicro + c.usdMicro, aznMicro: a.aznMicro + c.aznMicro }),
    { usdMicro: 0, aznMicro: 0 },
  );
}
