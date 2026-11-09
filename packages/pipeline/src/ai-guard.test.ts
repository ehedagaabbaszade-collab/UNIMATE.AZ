import { ProviderNotConfiguredError, type AiProvider, type EmbedRequest, type EmbedResult, type GenerateRequest, type GenerateResult } from "@unimate/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asUser } from "../../db/src/harness";
import { BudgetExceededError, GuardedProvider, RateLimitedError, SqlAiLedger, classifyFailure, subRequestId } from "./ai-guard";
import { embedAll } from "./ai";
import { PipelineError } from "./errors";
import { readyDocFromText } from "./fixtures";
import { generateSummary } from "./generate";
import { pgliteExecutor } from "./pglite-repository";
import { ProviderHttpError } from "./providers/http";
import { askDocument } from "./rag";
import { Dim1536FakeProvider, createEnv, ids, type TestEnv } from "./test-utils";

let env: TestEnv;
let ledger: SqlAiLedger;
const ADMIN = "00000000-0000-4000-8000-0000000000d2";
const A = ids.alice;
const B = ids.bob;

type Step = (req: GenerateRequest) => GenerateResult | Promise<GenerateResult>;
const ok = (tokensIn = 1000, tokensOut = 500, text = "hi"): Step => (req) => ({ text, model: req.model, usage: { inputTokens: tokensIn, outputTokens: tokensOut } });
const fail = (e: unknown): Step => () => {
  throw e;
};
const http = (status: number) => new ProviderHttpError("fake", status, "x");

/** Scripted provider: the nth call runs steps[n] (last step repeats). Records the model of every call. */
class Scripted implements AiProvider {
  readonly name = "scripted";
  readonly models: string[] = [];
  constructor(private readonly steps: Step[]) {}
  async generate(req: GenerateRequest): Promise<GenerateResult> {
    this.models.push(req.model);
    return this.steps[Math.min(this.models.length - 1, this.steps.length - 1)]!(req);
  }
  async embed(req: EmbedRequest): Promise<EmbedResult> {
    this.models.push(req.model);
    return { vectors: req.inputs.map(() => [0]), model: req.model, usage: { inputTokens: req.inputs.length, outputTokens: 0 } };
  }
}

const adminSql = (sql: string, params: unknown[] = []) => asUser(env.db, ADMIN, (tx) => tx.query<any>(sql, params));
const raw = async (sql: string, params: unknown[] = []) => (await env.db.query<any>(sql, params)).rows;
let seq = 0;
const rid = () => `guard-${String(++seq).padStart(5, "0")}-${Math.random().toString(36).slice(2, 8)}`;

let prov: string;
const mdl: Record<string, string> = {};
const model = async (name: string, tier: string, i: number, o: number, c: number, fb: boolean, max = 1000) =>
  (mdl[name] = (await adminSql("select public.admin_set_ai_model($1, $2, $3, $4, $5, $6, $7, true, $8) as id", [prov, name, tier, i, o, c, max, fb])).rows[0].id);

beforeAll(async () => {
  env = await createEnv();
  await env.db.query("insert into auth.users (id, email) values ($1, 'admin@example.test')", [ADMIN]);
  await env.db.query("update public.profiles set role = 'admin' where id = $1", [ADMIN]);
  ledger = new SqlAiLedger(pgliteExecutor(env.db));
}, 120_000);
afterAll(async () => {
  await env.db.close();
});

/** Fresh config per test: big (premium) primary, small + small2 approved cheaper fallbacks, embed model, generous budgets. */
async function configure(opts: { rate?: number; userLimit?: number; globalLimit?: number } = {}) {
  for (const t of ["ai_rate_limits", "ai_reservations", "ai_spend", "ai_task_routes", "ai_budgets"]) await raw(`delete from public.${t}`);
  await raw("delete from public.ai_usage");
  await raw("delete from public.ai_models");
  await raw("delete from public.ai_providers");
  prov = (await adminSql("select public.admin_set_ai_provider('prov-a', 'openai', true, null) as id")).rows[0].id;
  await model("big", "premium", 3_000_000, 15_000_000, 300_000, false);
  await model("small", "small", 150_000, 600_000, 15_000, true);
  await model("small2", "small", 150_000, 600_000, 15_000, true);
  await model("embedder", "small", 20_000, 0, 0, false, 1);
  for (const task of ["chat", "rag", "summarize", "quiz"])
    await adminSql("select public.admin_set_ai_route($1::public.ai_task, 'free', $2, $3::uuid[], $4)", [task, mdl.big, [mdl.small, mdl.small2], opts.rate ?? 100]);
  await adminSql("select public.admin_set_ai_route('embed', 'free', $1, '{}', $2)", [mdl.embedder, opts.rate ?? 1000]);
  await adminSql("select public.admin_set_ai_budget('global', '*', 'day', $1)", [opts.globalLimit ?? 1_000_000_000]);
  if (opts.userLimit !== undefined) await adminSql("select public.admin_set_ai_budget('user', '*', 'day', $1)", [opts.userLimit]);
}
const guardFor = (p: AiProvider, o: { maxRetries?: number; timeoutMs?: number } = {}) => {
  const sleeps: number[] = [];
  const g = new GuardedProvider({ ledger, provider: p, sleep: async (ms) => void sleeps.push(ms), random: () => 0.5, ...o });
  return { g, sleeps };
};
const ctx = (requestId = rid(), userId = A) => ({ userId, plan: "FREE" as const, requestId });
const call = (g: GuardedProvider, c = ctx(), task: "chat" | "rag" | "summarize" = "chat") => g.generate(c, task, { prompt: "hello world", system: "sys", maxOutputTokens: 500 });
const usageRows = (id: string) => raw("select * from public.ai_usage where request_id = $1", [id]);
const resv = async (id: string) => (await raw("select * from public.ai_reservations where request_id = $1", [id]))[0];
const reservedTotal = async () => Number((await raw("select coalesce(sum(reserved_micro_usd), 0) as s from public.ai_spend where scope = 'global' and period = 'day'"))[0].s);
const expectCode = async (p: Promise<unknown>, code: string) => {
  const e = await p.then(() => null, (x) => x);
  expect(e, `expected ${code}`).toBeInstanceOf(PipelineError);
  expect((e as PipelineError).code).toBe(code);
  return e as PipelineError;
};

describe("GuardedProvider: happy path and structured errors", () => {
  beforeEach(() => configure());

  it("routes by DB config, reserves, calls the routed model, settles to one ai_usage row", async () => {
    const p = new Scripted([ok(5, 400)]);
    const { g } = guardFor(p);
    const c = ctx();
    const r = await call(g, c);
    expect(p.models).toEqual(["big"]);
    expect(r).toMatchObject({ text: "hi", fallbackUsed: false, modelId: mdl.big });
    const rows = await usageRows(c.requestId);
    expect(rows).toHaveLength(1);
    // big: 5*3 + 400*15 = 15 + 6000 = 6015 micro-USD (below the reserved worst case, so not clamped)
    expect(rows[0]).toMatchObject({ provider: "prov-a", task: "chat", model: "big", plan: "free", status: "settled", fallback_used: false });
    expect(Number(rows[0].cost_micro_usd)).toBe(6015);
    expect((await resv(c.requestId)).status).toBe("settled");
    expect(await reservedTotal()).toBe(0);
  });

  it("ai_not_configured when there is no route/budget/model: nothing is called, never a default model", async () => {
    await raw("delete from public.ai_task_routes");
    const p = new Scripted([ok()]);
    const { g } = guardFor(p);
    const e = await expectCode(call(g), "ai_not_configured");
    expect(e.billable).toBe(false);
    expect(p.models).toEqual([]);
    // route exists but there is no global budget: also not configured (no unlimited spending)
    await configure();
    await raw("delete from public.ai_budgets");
    await expectCode(call(g), "ai_not_configured");
    expect(p.models).toEqual([]);
    // quiz has no route for PLUS users
    await configure();
    await raw("insert into public.subscriptions (user_id, plan, status) values ($1, 'plus', 'active')", [B]);
    await expectCode(g.generate({ userId: B, plan: "PLUS", requestId: rid() }, "chat", { prompt: "x" }), "ai_not_configured");
    await raw("delete from public.subscriptions");
  });

  it("budget_exceeded carries scope+period, never calls the provider and never switches model", async () => {
    await configure({ userLimit: 1 }); // 1 micro-USD per user per day
    const p = new Scripted([ok()]);
    const { g } = guardFor(p);
    const e = (await expectCode(call(g), "budget_exceeded")) as BudgetExceededError;
    expect(e).toBeInstanceOf(BudgetExceededError);
    expect([e.scope, e.period, e.retryable, e.billable]).toEqual(["user", "day", false, false]);
    expect(p.models).toEqual([]);
    expect(await reservedTotal()).toBe(0);
    await configure({ globalLimit: 5 });
    expect(((await expectCode(call(g), "budget_exceeded")) as BudgetExceededError).scope).toBe("global");
  });

  it("rate_limited with retryAfter, before any reservation or call", async () => {
    await configure({ rate: 2 });
    const p = new Scripted([ok(10, 10)]);
    const { g } = guardFor(p);
    await call(g);
    await call(g);
    const e = (await expectCode(call(g), "rate_limited")) as RateLimitedError;
    expect(e.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(e.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(e.retryable).toBe(true);
    expect(p.models).toHaveLength(2);
    expect((await raw("select count(*)::int as c from public.ai_reservations"))[0].c).toBe(2);
  });

  it("an unconfigured provider releases the reservation and keeps the original error", async () => {
    const { g } = guardFor({ name: "nc", generate: async () => Promise.reject(new ProviderNotConfiguredError("x")), embed: async () => Promise.reject(new ProviderNotConfiguredError("x")) });
    const c = ctx();
    await expect(call(g, c)).rejects.toBeInstanceOf(ProviderNotConfiguredError);
    expect((await resv(c.requestId)).status).toBe("released");
  });
});

describe("GuardedProvider: failures, retries, fallback", () => {
  beforeEach(() => configure());

  it("transient never-billed failures retry under the SAME reservation/request id with jittered backoff, then succeed", async () => {
    const p = new Scripted([fail(http(503)), fail(new PipelineError("provider_network", "conn", true, false)), ok(100, 100)]);
    const { g, sleeps } = guardFor(p);
    const c = ctx();
    const r = await call(g, c);
    expect(p.models).toEqual(["big", "big", "big"]); // bounded retries on the primary, no fallback needed
    expect(r.fallbackUsed).toBe(false);
    expect(sleeps).toHaveLength(2);
    expect(sleeps[1]!).toBeGreaterThan(sleeps[0]!); // exponential
    expect((await raw("select count(*)::int as c from public.ai_reservations where request_id = $1", [c.requestId]))[0].c).toBe(1);
    expect(await usageRows(c.requestId)).toHaveLength(1);
  });

  it("falls back to an approved cheaper model only after the primary failed pre-billing, settling at the fallback price", async () => {
    const p = new Scripted([fail(http(500)), fail(http(502)), fail(http(503)), ok(1000, 500)]);
    const { g } = guardFor(p);
    const c = ctx();
    const r = await call(g, c);
    expect(p.models).toEqual(["big", "big", "big", "small"]);
    expect(r).toMatchObject({ fallbackUsed: true, modelId: mdl.small });
    const u = (await usageRows(c.requestId))[0];
    // small: 1000*0.15 + 500*0.6 = 150 + 300 = 450 (not the big-model 10500)
    expect(u).toMatchObject({ model: "small", fallback_used: true, status: "settled" });
    expect(Number(u.cost_micro_usd)).toBe(450);
    expect(await usageRows(c.requestId)).toHaveLength(1);
    expect(await reservedTotal()).toBe(0);
  });

  it("all candidates failing before billing => released, provider_error, unbilled", async () => {
    const p = new Scripted([fail(http(503))]);
    const { g } = guardFor(p, { maxRetries: 1 });
    const c = ctx();
    const e = await expectCode(call(g, c), "provider_error");
    expect([e.billable, e.retryable]).toEqual([false, true]);
    expect(p.models).toEqual(["big", "big", "small", "small", "small2", "small2"]);
    expect((await resv(c.requestId)).status).toBe("released");
    expect((await usageRows(c.requestId))[0]).toMatchObject({ status: "failed_unbilled", cost_micro_usd: 0 });
    expect(await reservedTotal()).toBe(0);
  });

  it("a refused request (400/401) is released at once: no retry, no fallback", async () => {
    const p = new Scripted([fail(http(400))]);
    const { g } = guardFor(p);
    const c = ctx();
    const e = await expectCode(call(g, c), "provider_error");
    expect([e.billable, e.retryable]).toEqual([false, false]);
    expect(p.models).toEqual(["big"]);
    expect((await resv(c.requestId)).status).toBe("released");
  });

  it("timeout after send is billable: settled at the reserved estimate, no retry, no fallback", async () => {
    const p = new Scripted([() => new Promise<GenerateResult>(() => {})]); // never resolves
    const { g } = guardFor(p, { timeoutMs: 20 });
    const c = ctx();
    const e = await expectCode(call(g, c), "provider_timeout");
    expect([e.billable, e.retryable]).toEqual([true, true]);
    expect(p.models).toEqual(["big"]);
    const r = await resv(c.requestId);
    expect(r.status).toBe("settled");
    const u = (await usageRows(c.requestId))[0];
    expect(u.status).toBe("failed_billable");
    expect(Number(u.cost_micro_usd)).toBe(Number(r.estimate_micro_usd));
    expect(Number(u.cost_micro_usd)).toBeGreaterThan(0);
    expect(await reservedTotal()).toBe(0);
  });

  it("a bad body / unknown error / 504 is billable at the estimate", async () => {
    for (const err of [new PipelineError("provider_bad_response", "bad json", true, true), new Error("boom"), http(504)]) {
      const p = new Scripted([fail(err)]);
      const { g } = guardFor(p);
      const c = ctx();
      const e = await expectCode(call(g, c), "provider_error");
      expect(e.billable).toBe(true);
      expect(p.models).toEqual(["big"]);
      expect((await usageRows(c.requestId))[0].status).toBe("failed_billable");
    }
  });

  it("classifyFailure", () => {
    expect(classifyFailure(http(429))).toBe("transient_unsent");
    expect(classifyFailure(http(503))).toBe("transient_unsent");
    expect(classifyFailure(http(504))).toBe("billable");
    expect(classifyFailure(http(408))).toBe("billable");
    expect(classifyFailure(http(401))).toBe("refused");
    expect(classifyFailure(new PipelineError("provider_timeout", "t", true, true))).toBe("billable");
    expect(classifyFailure(new ProviderNotConfiguredError("x"))).toBe("not_configured");
  });

  it("same request_id replayed after success: duplicate_request, no second call, no second row, no second deduction", async () => {
    const p = new Scripted([ok(5, 400)]);
    const { g } = guardFor(p);
    const c = ctx();
    await call(g, c);
    const spentBefore = Number((await raw("select spent_micro_usd from public.ai_spend where scope = 'global' and period = 'day'"))[0].spent_micro_usd);
    const e = await expectCode(call(g, c), "duplicate_request");
    expect(e.billable).toBe(false);
    expect(p.models).toEqual(["big"]);
    expect(await usageRows(c.requestId)).toHaveLength(1);
    expect(Number((await raw("select spent_micro_usd from public.ai_spend where scope = 'global' and period = 'day'"))[0].spent_micro_usd)).toBe(spentBefore);
  });

  it("a crashed attempt (reservation left open) is resumed with the same id without double-reserving", async () => {
    const c = ctx();
    await ledger.reserve({ requestId: c.requestId, userId: A, plan: "free", estimateMicroUsd: 50_000, task: "chat", modelId: mdl.big! });
    const p = new Scripted([ok(10, 10)]);
    const { g } = guardFor(p);
    await call(g, c);
    expect((await raw("select count(*)::int as c from public.ai_reservations where request_id = $1", [c.requestId]))[0].c).toBe(1);
    expect(await reservedTotal()).toBe(0);
  });
});

describe("fallback cost ceiling", () => {
  beforeEach(() => configure());
  const setRoute = (fallbacks: string[]) =>
    raw("update public.ai_task_routes set fallback_model_ids = $1::uuid[] where task = 'chat'", [fallbacks]);

  it("never uses a pricier, unapproved or disabled model, even if the config row says so (e.g. edited later)", async () => {
    // Bypass the RPC validation on purpose: this is what stale config after a price edit looks like.
    await model("pricey", "small", 9_000_000, 9_000_000, 9_000_000, true);
    await model("unapproved", "small", 1, 1, 1, false);
    await model("off", "small", 1, 1, 1, true);
    await raw("update public.ai_models set enabled = false where model = 'off'");
    await setRoute([mdl.pricey!, mdl.unapproved!, mdl.off!]);
    const p = new Scripted([fail(http(503))]);
    const { g } = guardFor(p, { maxRetries: 0 });
    await expectCode(call(g), "provider_error");
    expect(p.models).toEqual(["big"]); // nobody else was called
  });

  it("a fallback whose worst-case estimate exceeds the held reservation is skipped", async () => {
    // small3 has the same prices (allowed) but a much larger output cap, so its estimate outgrows the reservation.
    await model("small3", "small", 150_000, 600_000, 15_000, true, 1_000_000);
    await model("big-cap", "premium", 3_000_000, 15_000_000, 300_000, false, 1000);
    await raw("update public.ai_task_routes set primary_model_id = $1, fallback_model_ids = $2::uuid[] where task = 'chat'", [mdl["big-cap"], [mdl.small3, mdl.small]]);
    const p = new Scripted([fail(http(503))]);
    const { g } = guardFor(p, { maxRetries: 0 });
    // no maxOutputTokens: estimates use each model's own cap. small3 (1M tokens * 0.6) > big-cap estimate? 600000 vs 15000+9..: skip
    const e = await g.generate(ctx(), "chat", { prompt: "x" }).then(() => null, (x) => x);
    expect(e.code).toBe("provider_error");
    expect(p.models).toEqual(["big-cap", "small"]); // small3 skipped, cheaper-cap small tried
  });
});

describe("wiring in generate / rag / process", () => {
  let docA: string;
  beforeAll(async () => {
    docA = await readyDocFromText(env, A, ["Mitoxondri hüceyrənin enerji stansiyasıdır. ATP istehsal edir."]);
  });
  beforeEach(() => configure());
  const SUMMARY = JSON.stringify({ summary: "Xülasə ə ğ.", key_points: ["a", "b", "c"] });
  const usageCount = async () => Number((await raw("select count(*) as c from public.ai_usage"))[0].c);

  it("generateSummary: unconfigured => ai_not_configured and the quota unit is refunded", async () => {
    await raw("delete from public.ai_task_routes");
    const p = new Scripted([ok(1, 1, SUMMARY)]);
    const { g } = guardFor(p);
    const before = (await env.repo.getUsage(A, new Date())).aiMessagesToday;
    await expectCode(generateSummary({ repo: env.repo, provider: p, guard: g }, { userId: A, documentId: docA, kind: "short" }), "ai_not_configured");
    expect((await env.repo.getUsage(A, new Date())).aiMessagesToday).toBe(before);
    expect(p.models).toEqual([]);
  });

  it("generateSummary: one usage row via the ledger (no double recording); repair call gets its own id", async () => {
    let n = 0;
    const p = new Scripted([(req) => ({ text: ++n === 1 ? '{"summary":"x"}' : SUMMARY, model: req.model, usage: { inputTokens: 100, outputTokens: 50 } })]);
    const { g } = guardFor(p);
    const base = rid();
    const r = await generateSummary({ repo: env.repo, provider: p, guard: g }, { userId: A, documentId: docA, kind: "exam", requestId: base });
    expect(r.output.key_points).toHaveLength(3);
    expect(p.models).toEqual(["big", "big"]);
    const rows = await raw("select request_id, task, model from public.ai_usage order by request_id");
    expect(rows.map((x) => x.request_id)).toEqual([subRequestId(base, "gen"), subRequestId(base, "repair")]);
    expect(rows.every((x) => x.task === "summarize" && x.model === "big")).toBe(true);
  });

  it("generateSummary: budget_exceeded is surfaced as is and refunds the quota unit", async () => {
    await configure({ userLimit: 1 });
    const p = new Scripted([ok(1, 1, SUMMARY)]);
    const { g } = guardFor(p);
    const before = (await env.repo.getUsage(A, new Date())).aiMessagesToday;
    const e = await expectCode(generateSummary({ repo: env.repo, provider: p, guard: g }, { userId: A, documentId: docA, kind: "detailed" }), "budget_exceeded");
    expect(e).toBeInstanceOf(BudgetExceededError);
    expect((await env.repo.getUsage(A, new Date())).aiMessagesToday).toBe(before);
    expect(p.models).toEqual([]);
  });

  it("askDocument: embed + answer are separate billable calls under distinct ids, routed as embed and rag", async () => {
    const fake = new Dim1536FakeProvider((req) => "Cavab " + (req.prompt.match(/\[([0-9a-f-]{36})\]/)?.[1] ? `[${req.prompt.match(/\[([0-9a-f-]{36})\]/)![1]}]` : ""));
    const { g } = guardFor(fake);
    const base = rid();
    const r = await askDocument({ repo: env.repo, provider: fake, guard: g }, { userId: A, documentId: docA, question: "Mitoxondri nədir?", requestId: base });
    expect(r.answer).toContain("Cavab");
    const rows = await raw("select request_id, task, model, status from public.ai_usage order by task");
    expect(rows.map((x) => [x.request_id, x.task, x.model])).toEqual([
      [subRequestId(base, "embed:0"), "embed", "embedder"],
      [subRequestId(base, "answer"), "rag", "big"],
    ]);
    expect(rows.every((x) => x.status === "settled")).toBe(true);
  });

  it("embedAll with a guard: one settled row per batch, ids stable per job attempt", async () => {
    const fake = new Dim1536FakeProvider();
    const { g } = guardFor(fake);
    const base = `job:${rid()}:1`;
    const vecs = await embedAll({ repo: env.repo, provider: fake }, A, ["a", "b", "c", "d", "e"], 2, undefined, { guard: g, plan: "FREE", requestBase: base });
    expect(vecs).toHaveLength(5);
    const rows = await raw("select request_id, task from public.ai_usage order by request_id");
    expect(rows.map((x) => x.request_id)).toEqual([0, 1, 2].map((i) => subRequestId(base, `embed:${i}`)));
    expect(await usageCount()).toBe(3);
    // the legacy path (no guard, no models) refuses instead of defaulting to some model
    await expectCode(embedAll({ repo: env.repo, provider: fake }, A, ["x"]), "ai_not_configured");
  });
});

describe("embed rate limit counts one operation", () => {
  it("a multi-batch embed uses one rate slot (limit 1) while every batch is still budgeted and settled", async () => {
    await configure({ rate: 1 });
    await raw("update public.ai_task_routes set rate_limit_per_min = 1 where task = 'embed'");
    const fake = new Dim1536FakeProvider();
    const { g } = guardFor(fake);
    const base = `job:${rid()}:1`;
    const vecs = await embedAll({ repo: env.repo, provider: fake }, A, ["a", "b", "c", "d", "e"], 2, undefined, { guard: g, plan: "FREE", requestBase: base });
    expect(vecs).toHaveLength(5);
    expect((await raw("select count(*)::int as c from public.ai_usage where status = 'settled'"))[0].c).toBe(3);
    expect((await raw("select n from public.ai_rate_limits where task = 'embed'"))[0].n).toBe(1);
    // a second operation in the same minute is limited
    await expectCode(embedAll({ repo: env.repo, provider: fake }, A, ["x"], 2, undefined, { guard: g, plan: "FREE", requestBase: `job:${rid()}:1` }), "rate_limited");
  });
});

describe("orphan sweeper through the ledger", () => {
  beforeEach(() => configure());
  it("releases a reservation whose worker died", async () => {
    const id = rid();
    await ledger.reserve({ requestId: id, userId: A, plan: "free", estimateMicroUsd: 1234, task: "chat", modelId: mdl.big! });
    expect(await reservedTotal()).toBe(1234);
    await raw("update public.ai_reservations set created_at = now() - interval '1 hour' where request_id = $1", [id]);
    const n = (await pgliteExecutor(env.db).service((q) => q.query<any>("select public.ai_sweep_orphan_reservations(30) as n"))).rows[0].n;
    expect(n).toBe(1);
    expect(await reservedTotal()).toBe(0);
  });
});
