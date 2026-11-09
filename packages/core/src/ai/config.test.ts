import { describe, expect, it } from "vitest";
import {
  AiNotConfiguredError, EMPTY_AI_CONFIG, estimateCostMicroUsd, isCheaperOrEqual, modelCostMicroUsd, parseAiConfig, resolveRoute,
  toRouteTask, type AiConfig, type AiModelConfig,
} from "./config";

const model = (id: string, o: Partial<AiModelConfig> = {}): AiModelConfig => ({
  id, providerId: "p1", model: `m-${id}`, tier: "small", inputMicroUsdPerMTok: 100, outputMicroUsdPerMTok: 200,
  cachedInputMicroUsdPerMTok: 10, enabled: true, approvedFallback: true, maxOutputTokens: 1000, ...o,
});
const cfg = (models: AiModelConfig[], fallbacks: string[], primary = "big"): AiConfig => ({
  providers: [{ id: "p1", name: "prov", kind: "openai", enabled: true, baseUrlLabel: null }],
  models,
  routes: [{ task: "chat", plan: "free", primaryModelId: primary, fallbackModelIds: fallbacks, rateLimitPerMin: 7 }],
  budgets: [],
});
const BIG = model("big", { tier: "premium", inputMicroUsdPerMTok: 1000, outputMicroUsdPerMTok: 2000, cachedInputMicroUsdPerMTok: 100, approvedFallback: false });

describe("resolveRoute", () => {
  it("empty config => ai_not_configured (never a default model)", () => {
    expect(() => resolveRoute("chat", "FREE", EMPTY_AI_CONFIG)).toThrow(AiNotConfiguredError);
    try {
      resolveRoute("chat", "FREE", EMPTY_AI_CONFIG);
    } catch (e) {
      expect((e as AiNotConfiguredError).code).toBe("ai_not_configured");
    }
  });
  it("maps legacy tasks and plan ids; GROUP and unrouted tasks are not configured", () => {
    const c = cfg([BIG], []);
    expect(resolveRoute("chat", "FREE", c).primary.id).toBe("big");
    expect(resolveRoute("chat", "free", c).rateLimitPerMin).toBe(7);
    expect(() => resolveRoute("chat", "GROUP", c)).toThrow(/not configured/);
    expect(() => resolveRoute("chat", "PRO", c)).toThrow(AiNotConfiguredError);
    expect(() => resolveRoute("quiz", "FREE", c)).toThrow(AiNotConfiguredError);
    expect(toRouteTask("ocr_cleanup")).toBe("extract_cleanup");
    expect(toRouteTask("rag")).toBe("rag");
  });
  it("keeps cheaper-or-equal approved fallbacks in order and drops everything else", () => {
    const small = model("small");
    const equalToBig = model("eq", { tier: "premium", inputMicroUsdPerMTok: 1000, outputMicroUsdPerMTok: 2000, cachedInputMicroUsdPerMTok: 100 });
    const pricier = model("pricey", { inputMicroUsdPerMTok: 1001 });
    const higherTier = model("hi", { tier: "premium", inputMicroUsdPerMTok: 1, outputMicroUsdPerMTok: 1, cachedInputMicroUsdPerMTok: 1 });
    const unapproved = model("un", { approvedFallback: false });
    const disabled = model("off", { enabled: false });
    const r = resolveRoute("chat", "FREE", cfg([BIG, small, equalToBig, pricier, unapproved, disabled], ["small", "pricey", "un", "off", "eq", "small", "big", "ghost"]));
    expect(r.fallbacks.map((m) => m.id)).toEqual(["small", "eq"]);
    // higher tier than a small primary is never allowed even if cheaper
    const r2 = resolveRoute("chat", "FREE", cfg([model("sm"), higherTier], ["hi"], "sm"));
    expect(r2.fallbacks).toEqual([]);
  });
  it("a price edit that breaks the ceiling drops the fallback instead of using a pricier model", () => {
    const fb = model("fb", { outputMicroUsdPerMTok: 5000 });
    expect(resolveRoute("chat", "FREE", cfg([BIG, fb], ["fb"])).fallbacks).toEqual([]);
  });
  it("disabled primary or provider => ai_not_configured", () => {
    expect(() => resolveRoute("chat", "FREE", cfg([{ ...BIG, enabled: false }], []))).toThrow(/primary model/);
    const c = cfg([BIG], []);
    c.providers[0]!.enabled = false;
    expect(() => resolveRoute("chat", "FREE", c)).toThrow(AiNotConfiguredError);
  });
  it("carries provider info", () => {
    expect(resolveRoute("chat", "FREE", cfg([BIG], [])).primary).toMatchObject({ providerName: "prov", providerKind: "openai" });
  });
});

describe("cost math", () => {
  it("rounds up and prices cached input separately", () => {
    const m = model("x", { inputMicroUsdPerMTok: 150_000, outputMicroUsdPerMTok: 600_000, cachedInputMicroUsdPerMTok: 15_000 });
    expect(modelCostMicroUsd(m, { inputTokens: 10_000, outputTokens: 1_000, cachedInputTokens: 2_000 })).toBe(1830);
    expect(modelCostMicroUsd(m, { inputTokens: 1, outputTokens: 0 })).toBe(1);
    expect(modelCostMicroUsd(m, { inputTokens: 0, outputTokens: 0 })).toBe(0);
    expect(modelCostMicroUsd(m, { inputTokens: 5, outputTokens: 0, cachedInputTokens: 99 })).toBe(1); // cached clamped to input
    expect(() => modelCostMicroUsd(m, { inputTokens: -1, outputTokens: 0 })).toThrow(RangeError);
  });
  it("estimate caps output at the model max", () => {
    const m = model("x", { inputMicroUsdPerMTok: 1_000_000, outputMicroUsdPerMTok: 1_000_000, maxOutputTokens: 100 });
    expect(estimateCostMicroUsd(m, 50, 1_000_000)).toBe(150);
    expect(estimateCostMicroUsd(m, 50, 10)).toBe(60);
    expect(estimateCostMicroUsd(m, 50)).toBe(150);
  });
  it("isCheaperOrEqual", () => {
    expect(isCheaperOrEqual(model("a"), model("a"))).toBe(true);
    expect(isCheaperOrEqual(model("a", { cachedInputMicroUsdPerMTok: 11 }), model("b"))).toBe(false);
  });
});

describe("parseAiConfig", () => {
  it("parses the ai_load_config jsonb (bigints may arrive as strings)", () => {
    const c = parseAiConfig({
      providers: [{ id: "p", name: "n", kind: "openai", enabled: true, base_url_label: null }],
      models: [{ id: "m", provider_id: "p", model: "x", tier: "small", input_micro_usd_per_mtok: "5", output_micro_usd_per_mtok: 6,
        cached_input_micro_usd_per_mtok: 1, enabled: true, approved_fallback: false, max_output_tokens: 10 }],
      routes: [{ task: "chat", plan: "free", primary_model_id: "m", fallback_model_ids: [], rate_limit_per_min: 3 }],
      budgets: [{ scope: "global", key: "*", period: "day", hard_limit_micro_usd: 99 }],
    });
    expect(c.models[0]!.inputMicroUsdPerMTok).toBe(5);
    expect(resolveRoute("chat", "FREE", c).primary.model).toBe("x");
    expect(c.budgets[0]!.hardLimitMicroUsd).toBe(99);
    expect(parseAiConfig(null)).toEqual(EMPTY_AI_CONFIG);
    expect(() => parseAiConfig({ models: [{ id: "m" }] })).toThrow(TypeError);
  });
});
