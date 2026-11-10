import {
  AiNotConfiguredError,
  ProviderNotConfiguredError,
  estimateCostMicroUsd,
  parseAiConfig,
  resolveRoute,
  type AiConfig,
  type AiProvider,
  type AiTask,
  type EmbedResult,
  type GenerateResult,
  type PlanId,
  type ResolvedModel,
  type ResolvedRoute,
  type RouteTask,
  type TokenUsage,
} from "@unimate/core";
import { PipelineError } from "./errors";
import { ProviderHttpError } from "./providers/http";
import type { Queryable, SqlExecutor } from "./sql-repository";

// ---------------------------------------------------------------- errors (stable machine codes)
/** `budget_exceeded`: a hard spend ceiling would be crossed. Never answered by switching models. */
export class BudgetExceededError extends PipelineError {
  constructor(readonly scope: "user" | "plan" | "global", readonly period: "day" | "month") {
    super("budget_exceeded", `The ${scope} AI budget for this ${period} has been reached`, false, false);
    this.name = "BudgetExceededError";
  }
}
/** `rate_limited`: too many requests for this task in the current minute. */
export class RateLimitedError extends PipelineError {
  constructor(readonly retryAfterSeconds: number) {
    super("rate_limited", `Too many AI requests. Retry in ${retryAfterSeconds}s`, true, false);
    this.name = "RateLimitedError";
  }
}
const notConfigured = (detail: string) => new PipelineError("ai_not_configured", `AI is not configured: ${detail}`, false, false);

// ---------------------------------------------------------------- ledger (the DB side of the guard)
export type ReserveOutcome =
  | { ok: true; existing: boolean; status: "reserved" | "settled"; estimateMicroUsd: number }
  | { ok: false; error: "budget_exceeded"; scope: "user" | "plan" | "global"; period: "day" | "month" }
  | { ok: false; error: "ai_not_configured" | "plan_mismatch" | "request_id_conflict"; reason?: string };
export type RateOutcome = { ok: true } | { ok: false; error: "rate_limited"; retryAfterSeconds: number } | { ok: false; error: "ai_not_configured" };

export interface SettleInput {
  requestId: string;
  modelId: string;
  /** null = usage unknown (billable failure): the reserved estimate is charged. */
  usage: TokenUsage | null;
  status: "settled" | "failed_billable";
  fallbackUsed: boolean;
}
/** Everything the guard needs from the database. Separate from Repository so existing repositories are untouched. */
export interface AiLedger {
  loadConfig(): Promise<AiConfig>;
  checkRate(userId: string, task: RouteTask): Promise<RateOutcome>;
  reserve(i: { requestId: string; userId: string; plan: string; estimateMicroUsd: number; task: RouteTask; modelId: string }): Promise<ReserveOutcome>;
  settle(i: SettleInput): Promise<void>;
  release(requestId: string): Promise<void>;
}

const asJson = (v: unknown): any => (typeof v === "string" ? JSON.parse(v) : v);

/** AiLedger over the service_role RPCs from 20260101001900_ai_cost_config.sql. */
export class SqlAiLedger implements AiLedger {
  constructor(private readonly exec: SqlExecutor) {}
  private async rpc(sql: string, params: unknown[]): Promise<any> {
    const rows = await this.exec.service((q: Queryable) => q.query<{ r: unknown }>(sql, params));
    return asJson(rows.rows[0]?.r);
  }
  async loadConfig(): Promise<AiConfig> {
    return parseAiConfig(await this.rpc("select public.ai_load_config() as r", []));
  }
  async checkRate(userId: string, task: RouteTask): Promise<RateOutcome> {
    const r = await this.rpc("select public.ai_rate_limit_check($1, $2::public.ai_task) as r", [userId, task]);
    if (r.ok) return { ok: true };
    if (r.error === "rate_limited") return { ok: false, error: "rate_limited", retryAfterSeconds: Number(r.retry_after_seconds) || 1 };
    return { ok: false, error: "ai_not_configured" };
  }
  async reserve(i: Parameters<AiLedger["reserve"]>[0]): Promise<ReserveOutcome> {
    const r = await this.rpc("select public.reserve_ai_budget($1, $2, $3, $4, $5, $6) as r", [
      i.requestId, i.userId, i.plan, i.estimateMicroUsd, i.task, i.modelId,
    ]);
    if (r.ok) return { ok: true, existing: r.existing === true, status: r.status, estimateMicroUsd: Number(r.estimate_micro_usd) };
    if (r.error === "budget_exceeded") return { ok: false, error: "budget_exceeded", scope: r.scope, period: r.period };
    return { ok: false, error: r.error, ...(r.reason ? { reason: r.reason } : {}) };
  }
  async settle(i: SettleInput): Promise<void> {
    const u = i.usage;
    const r = await this.rpc("select public.settle_ai_budget($1, $2, $3, $4, $5, $6, $7) as r", [
      i.requestId, i.modelId, u ? u.inputTokens : null, u ? u.outputTokens : null, u?.cachedInputTokens ?? 0, i.status, i.fallbackUsed,
    ]);
    if (!r?.ok) throw new PipelineError("ai_ledger_error", `settle failed: ${r?.error ?? "unknown"}`, false, true);
  }
  async release(requestId: string): Promise<void> {
    await this.rpc("select public.release_ai_budget($1) as r", [requestId]);
  }
}

// ---------------------------------------------------------------- guarded provider
export interface GuardContext {
  userId: string;
  plan: PlanId;
  /** Idempotency key of ONE logical provider call. Transport retries and fallbacks reuse it; distinct calls need distinct ids. */
  requestId: string;
  /** Skip the per-minute rate-limit slot: one logical operation (e.g. a multi-batch embed) counts once; the budget still applies to every call. */
  skipRateLimit?: boolean;
}
export interface GuardedGenerateResult extends GenerateResult {
  modelId: string;
  fallbackUsed: boolean;
}
export interface GuardedEmbedResult extends EmbedResult {
  modelId: string;
  fallbackUsed: boolean;
}
export interface GuardedOptions {
  ledger: AiLedger;
  /** One provider for everything, or a factory choosing by the routed model's provider kind/name. */
  provider: AiProvider | ((m: ResolvedModel) => AiProvider);
  /** Per-attempt time limit. A timed-out call may still be running at the provider, so it is billable. Default 60 s. */
  timeoutMs?: number;
  /** Extra attempts per model for transient, never-billed failures. Default 2 (3 attempts). */
  maxRetries?: number;
  baseBackoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

type Failure = "not_configured" | "transient_unsent" | "refused" | "billable";
/** 429/500/502/503: the provider answered with an error before doing work. 504 is ambiguous (upstream may have run). */
const TRANSIENT_STATUS = new Set([429, 500, 502, 503]);

export function classifyFailure(e: unknown): Failure {
  if (e instanceof ProviderNotConfiguredError) return "not_configured";
  if (e instanceof ProviderHttpError) {
    if (TRANSIENT_STATUS.has(e.status)) return "transient_unsent";
    return e.billable ? "billable" : "refused"; // other 4xx (not 408/429) = refused, never billed
  }
  if (e instanceof PipelineError) {
    if (e.code === "provider_network" && !e.billable) return "transient_unsent"; // connection failed before any response
    return e.billable ? "billable" : "refused";
  }
  return "billable"; // unknown: assume the provider may have worked
}

const LEGACY_TASK: Record<RouteTask, AiTask> = {
  extract_cleanup: "ocr_cleanup", summarize: "summarize", rag: "chat", chat: "chat", quiz: "quiz",
  flashcards: "flashcards", exam_simulation: "quiz", embed: "embed", cv_feedback: "cv_feedback", interview_prep: "interview_prep",
};
/** Deliberately pessimistic (3 chars/token) so the reservation covers real usage; the excess is released at settle. */
export const approxTokens = (chars: number): number => Math.ceil(chars / 3);

/**
 * Conservative input-token estimate for real text: Latin script (incl. az/tr extended letters, below U+0370) at 3
 * chars/token, every other script (Cyrillic for ru, Greek, CJK, ...) at 2 chars/token, which tokenizes far worse.
 * Counted per code point so surrogate pairs are not double counted.
 */
export function estimateInputTokens(texts: readonly string[]): number {
  let latin = 0;
  let other = 0;
  for (const t of texts) {
    for (const ch of t) {
      if (ch.codePointAt(0)! >= 0x370) other++;
      else latin++;
    }
  }
  return Math.ceil(latin / 3 + other / 2);
}

export class GuardedProvider {
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseBackoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  constructor(private readonly o: GuardedOptions) {
    this.timeoutMs = o.timeoutMs ?? 60_000;
    this.maxRetries = o.maxRetries ?? 2;
    this.baseBackoffMs = o.baseBackoffMs ?? 250;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = o.random ?? Math.random;
  }

  /** Loads the DB config and resolves the route. Throws PipelineError("ai_not_configured") when nothing is routed. */
  async resolve(task: AiTask | RouteTask, plan: PlanId): Promise<ResolvedRoute> {
    const config = await this.o.ledger.loadConfig();
    try {
      return resolveRoute(task, plan, config);
    } catch (e) {
      if (e instanceof AiNotConfiguredError) throw notConfigured(e.message);
      throw e;
    }
  }

  async generate(
    ctx: GuardContext,
    task: AiTask | RouteTask,
    req: { system?: string; prompt: string; maxOutputTokens?: number },
    opts: { route?: ResolvedRoute } = {},
  ): Promise<GuardedGenerateResult> {
    const route = opts.route ?? (await this.resolve(task, ctx.plan));
    const inTokens = estimateInputTokens([req.system ?? "", req.prompt]);
    return this.execute(
      ctx,
      route,
      (m) => estimateCostMicroUsd(m, inTokens, req.maxOutputTokens),
      async (provider, m) => {
        const r = await provider.generate({
          task: LEGACY_TASK[route.task],
          model: m.model,
          prompt: req.prompt,
          ...(req.system !== undefined ? { system: req.system } : {}),
          ...(req.maxOutputTokens !== undefined ? { maxOutputTokens: Math.min(req.maxOutputTokens, m.maxOutputTokens) } : { maxOutputTokens: m.maxOutputTokens }),
        });
        return { value: r, usage: r.usage };
      },
    );
  }

  async embed(ctx: GuardContext, inputs: string[], opts: { route?: ResolvedRoute } = {}): Promise<GuardedEmbedResult> {
    const route = opts.route ?? (await this.resolve("embed", ctx.plan));
    const inTokens = estimateInputTokens(inputs);
    return this.execute(
      ctx,
      route,
      (m) => estimateCostMicroUsd(m, inTokens, 0),
      async (provider, m) => {
        const r = await provider.embed({ model: m.model, inputs });
        return { value: r, usage: r.usage };
      },
    );
  }

  private providerFor(m: ResolvedModel): AiProvider {
    return typeof this.o.provider === "function" ? this.o.provider(m) : this.o.provider;
  }

  private async withTimeout<T>(p: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new PipelineError("provider_timeout", `AI provider timed out after ${this.timeoutMs} ms`, false, true)), this.timeoutMs);
    });
    try {
      return await Promise.race([p, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async execute<T extends { model: string; usage: TokenUsage }>(
    ctx: GuardContext,
    route: ResolvedRoute,
    estimateFor: (m: ResolvedModel) => number,
    call: (p: AiProvider, m: ResolvedModel) => Promise<{ value: T; usage: TokenUsage }>,
  ): Promise<T & { modelId: string; fallbackUsed: boolean }> {
    const { ledger } = this.o;

    const rate = ctx.skipRateLimit ? ({ ok: true } as const) : await ledger.checkRate(ctx.userId, route.task);
    if (!rate.ok) {
      if (rate.error === "rate_limited") throw new RateLimitedError(rate.retryAfterSeconds);
      throw notConfigured(`no route for ${route.task}`);
    }

    const reserved = await ledger.reserve({
      requestId: ctx.requestId, userId: ctx.userId, plan: ctx.plan.toLowerCase(), estimateMicroUsd: estimateFor(route.primary),
      task: route.task, modelId: route.primary.id,
    });
    if (!reserved.ok) {
      if (reserved.error === "budget_exceeded") throw new BudgetExceededError(reserved.scope, reserved.period);
      if (reserved.error === "ai_not_configured") throw notConfigured(reserved.reason ?? "budget");
      throw new PipelineError("ai_ledger_error", `reservation refused: ${reserved.error}`, false, false);
    }
    // Same request_id seen before and already paid for: never call (and pay) the provider a second time.
    if (reserved.status === "settled") throw new PipelineError("duplicate_request", "This AI request was already completed", false, false);
    // Same request_id still open ('reserved'): another worker may be mid-call (or crashed after calling). A second paid
    // call would double-spend, so refuse; the orphan sweeper settles an abandoned reservation at its estimate.
    if (reserved.existing && reserved.status === "reserved") throw new PipelineError("request_in_progress", "This AI request is already in progress", false, false);
    const cap = reserved.estimateMicroUsd;

    const candidates = [route.primary, ...route.fallbacks];
    for (let i = 0; i < candidates.length; i++) {
      const m = candidates[i]!;
      // A fallback must fit the reservation we already hold (it is cheaper-or-equal per token, but its output cap may differ).
      if (i > 0 && estimateFor(m) > cap) continue;
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        try {
          const { value, usage } = await this.withTimeout(call(this.providerFor(m), m));
          await this.settleOnce({ requestId: ctx.requestId, modelId: m.id, usage, status: "settled", fallbackUsed: i > 0 });
          return { ...value, modelId: m.id, fallbackUsed: i > 0 };
        } catch (e) {
          if (e instanceof PipelineError && e.code === "ai_ledger_error") throw e; // paid, settle failed: surface (billable)
          const kind = classifyFailure(e);
          if (kind === "not_configured") {
            await this.releaseQuietly(ctx.requestId);
            throw e;
          }
          if (kind === "refused") {
            await this.releaseQuietly(ctx.requestId);
            throw new PipelineError("provider_error", "The AI provider refused the request", false, false);
          }
          if (kind === "billable") {
            // Sent and possibly executed (timeout, bad body, unknown): charge the reserved estimate. No retry, no fallback.
            await this.settleOnce({ requestId: ctx.requestId, modelId: m.id, usage: null, status: "failed_billable", fallbackUsed: i > 0 });
            const timeout = e instanceof PipelineError && e.code === "provider_timeout";
            throw new PipelineError(timeout ? "provider_timeout" : "provider_error", timeout ? "The AI provider timed out" : "The AI provider returned an unusable response", true, true);
          }
          if (attempt < this.maxRetries) await this.sleep(Math.min(5_000, this.baseBackoffMs * 2 ** attempt * (0.5 + this.random() * 0.5)));
        }
      }
      // retries exhausted on this model without any billable work: try the next (cheaper-or-equal) candidate
    }
    await this.releaseQuietly(ctx.requestId);
    throw new PipelineError("provider_error", "The AI provider is unavailable", true, false);
  }

  private async settleOnce(i: SettleInput): Promise<void> {
    try {
      await this.o.ledger.settle(i);
    } catch {
      try {
        await this.o.ledger.settle(i); // one more try: settle is idempotent
      } catch {
        throw new PipelineError("ai_ledger_error", "Could not record AI usage", true, true);
      }
    }
  }
  private async releaseQuietly(requestId: string): Promise<void> {
    try {
      await this.o.ledger.release(requestId);
    } catch {
      /* the orphan sweeper (ai_sweep_orphan_reservations) settles it later, at the estimate (billable) */
    }
  }
}

/** Derived ids for distinct billable calls inside one logical operation (repair call, embed batch, ...). */
export const subRequestId = (base: string, part: string): string => `${base}:${part}`;
