import type { PlanId } from "../billing/entitlements";
import type { AiTask, ModelTier } from "./provider";

/**
 * DB-backed AI routing and pricing. The pipeline loads an `AiConfig` (ai_load_config RPC -> parseAiConfig) and injects
 * it; nothing here reads the environment and nothing defaults to a model: no route means `ai_not_configured`.
 * Prices are integer micro-USD per 1,000,000 tokens (1 USD/MTok = 1_000_000).
 */
export const ROUTE_TASKS = ["extract_cleanup", "summarize", "rag", "chat", "quiz", "flashcards", "exam_simulation", "embed"] as const;
export type RouteTask = (typeof ROUTE_TASKS)[number];
export const ROUTE_PLANS = ["free", "plus", "pro"] as const;
export type RoutePlan = (typeof ROUTE_PLANS)[number];

/**
 * Legacy `AiTask` -> routing task. `ocr_cleanup` is extract_cleanup. Document Q&A (rag.ts) passes `rag` explicitly;
 * a plain `chat` stays `chat`.
 */
export const toRouteTask = (t: AiTask | RouteTask): RouteTask => (t === "ocr_cleanup" ? "extract_cleanup" : t);

/** GROUP has no billing plan row (and therefore no route): it resolves to "group" and fails as not configured. */
export const toRoutePlan = (p: PlanId | RoutePlan): string => p.toLowerCase();

export interface AiProviderConfig {
  id: string;
  name: string;
  kind: "openai" | "anthropic";
  enabled: boolean;
  baseUrlLabel: string | null;
}
export interface AiModelConfig {
  id: string;
  providerId: string;
  model: string;
  tier: ModelTier;
  inputMicroUsdPerMTok: number;
  outputMicroUsdPerMTok: number;
  cachedInputMicroUsdPerMTok: number;
  enabled: boolean;
  approvedFallback: boolean;
  maxOutputTokens: number;
}
export interface AiRouteConfig {
  task: RouteTask;
  plan: RoutePlan;
  primaryModelId: string;
  fallbackModelIds: string[];
  rateLimitPerMin: number;
}
export interface AiBudgetConfig {
  scope: "user" | "plan" | "global";
  key: string;
  period: "day" | "month";
  hardLimitMicroUsd: number;
}
export interface AiConfig {
  providers: AiProviderConfig[];
  models: AiModelConfig[];
  routes: AiRouteConfig[];
  budgets: AiBudgetConfig[];
}
export const EMPTY_AI_CONFIG: AiConfig = { providers: [], models: [], routes: [], budgets: [] };

/** A model joined with its provider: what the pipeline needs to make one call. */
export interface ResolvedModel extends AiModelConfig {
  providerName: string;
  providerKind: "openai" | "anthropic";
}
export interface ResolvedRoute {
  task: RouteTask;
  plan: RoutePlan;
  primary: ResolvedModel;
  /** Ordered, already filtered: approved, enabled, never more expensive or higher tier than the primary. */
  fallbacks: ResolvedModel[];
  rateLimitPerMin: number;
}

/** Stable machine code `ai_not_configured`: nothing is routed for this (task, plan), or its primary is unusable. */
export class AiNotConfiguredError extends Error {
  readonly code = "ai_not_configured";
  constructor(readonly task: string, readonly plan: string, detail = "no route configured") {
    super(`AI is not configured for ${task}/${plan}: ${detail}`);
    this.name = "AiNotConfiguredError";
  }
}

export const TIER_RANK: Record<ModelTier, number> = { small: 1, standard: 2, premium: 3 };

/** True when `candidate` is never more expensive than `primary` on any price axis, and not a higher tier. */
export function isCheaperOrEqual(candidate: AiModelConfig, primary: AiModelConfig): boolean {
  return (
    candidate.inputMicroUsdPerMTok <= primary.inputMicroUsdPerMTok &&
    candidate.outputMicroUsdPerMTok <= primary.outputMicroUsdPerMTok &&
    candidate.cachedInputMicroUsdPerMTok <= primary.cachedInputMicroUsdPerMTok &&
    TIER_RANK[candidate.tier] <= TIER_RANK[primary.tier]
  );
}

/**
 * Pure resolver. Primary must exist and be enabled (with an enabled provider). Fallbacks that no longer satisfy the
 * cost ceiling (price edited after the route was written), are not approved, disabled, duplicated or equal to the
 * primary are DROPPED, never substituted. It never upgrades a tier.
 */
export function resolveRoute(task: AiTask | RouteTask, plan: PlanId | RoutePlan, config: AiConfig): ResolvedRoute {
  const t = toRouteTask(task);
  const p = toRoutePlan(plan);
  const route = config.routes.find((r) => r.task === t && r.plan === p);
  if (!route) throw new AiNotConfiguredError(t, p);
  const join = (id: string): ResolvedModel | null => {
    const m = config.models.find((x) => x.id === id);
    const prov = m && config.providers.find((x) => x.id === m.providerId);
    if (!m || !prov || !m.enabled || !prov.enabled) return null;
    return { ...m, providerName: prov.name, providerKind: prov.kind };
  };
  const primary = join(route.primaryModelId);
  if (!primary) throw new AiNotConfiguredError(t, p, "primary model is missing or disabled");
  const seen = new Set([primary.id]);
  const fallbacks: ResolvedModel[] = [];
  for (const id of route.fallbackModelIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const m = join(id);
    if (m && m.approvedFallback && isCheaperOrEqual(m, primary)) fallbacks.push(m);
  }
  return { task: t, plan: p as RoutePlan, primary, fallbacks, rateLimitPerMin: route.rateLimitPerMin };
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}
/** Integer micro-USD for a usage at a model's prices: ceil((fresh*in + cached*cachedIn + out*out) / 1e6). */
export function modelCostMicroUsd(m: AiModelConfig, u: ModelUsage): number {
  const cached = Math.min(u.cachedInputTokens ?? 0, u.inputTokens);
  if (u.inputTokens < 0 || u.outputTokens < 0 || cached < 0) throw new RangeError("negative token usage");
  const num = (u.inputTokens - cached) * m.inputMicroUsdPerMTok + cached * m.cachedInputMicroUsdPerMTok + u.outputTokens * m.outputMicroUsdPerMTok;
  return Math.floor((num + 999_999) / 1_000_000); // identical to settle_ai_budget in SQL
}

/** Worst-case cost of one call: all input tokens fresh plus the full output cap (the amount to reserve). */
export function estimateCostMicroUsd(m: AiModelConfig, inputTokens: number, maxOutputTokens?: number): number {
  const out = Math.min(maxOutputTokens ?? m.maxOutputTokens, m.maxOutputTokens);
  return modelCostMicroUsd(m, { inputTokens, outputTokens: out });
}

// ---------------------------------------------------------------- loading (DB jsonb -> AiConfig)
type J = Record<string, unknown>;
const str = (o: J, k: string): string => {
  const v = o[k];
  if (typeof v !== "string") throw new TypeError(`ai config: ${k} must be a string`);
  return v;
};
const num = (o: J, k: string): number => {
  const v = Number(o[k]);
  if (!Number.isFinite(v)) throw new TypeError(`ai config: ${k} must be a number`);
  return v;
};
const arr = (v: unknown): J[] => (Array.isArray(v) ? (v as J[]) : []);

/** Parses the jsonb returned by ai_load_config(). Throws TypeError on malformed rows (fail closed). */
export function parseAiConfig(json: unknown): AiConfig {
  const o = (json ?? {}) as J;
  return {
    providers: arr(o.providers).map((p) => ({
      id: str(p, "id"), name: str(p, "name"), kind: str(p, "kind") as "openai" | "anthropic", enabled: p.enabled === true,
      baseUrlLabel: typeof p.base_url_label === "string" ? p.base_url_label : null,
    })),
    models: arr(o.models).map((m) => ({
      id: str(m, "id"), providerId: str(m, "provider_id"), model: str(m, "model"), tier: str(m, "tier") as ModelTier,
      inputMicroUsdPerMTok: num(m, "input_micro_usd_per_mtok"), outputMicroUsdPerMTok: num(m, "output_micro_usd_per_mtok"),
      cachedInputMicroUsdPerMTok: num(m, "cached_input_micro_usd_per_mtok"), enabled: m.enabled === true,
      approvedFallback: m.approved_fallback === true, maxOutputTokens: num(m, "max_output_tokens"),
    })),
    routes: arr(o.routes).map((r) => ({
      task: str(r, "task") as RouteTask, plan: str(r, "plan") as RoutePlan, primaryModelId: str(r, "primary_model_id"),
      fallbackModelIds: Array.isArray(r.fallback_model_ids) ? (r.fallback_model_ids as string[]) : [],
      rateLimitPerMin: num(r, "rate_limit_per_min"),
    })),
    budgets: arr(o.budgets).map((b) => ({
      scope: str(b, "scope") as AiBudgetConfig["scope"], key: str(b, "key"), period: str(b, "period") as "day" | "month",
      hardLimitMicroUsd: num(b, "hard_limit_micro_usd"),
    })),
  };
}
