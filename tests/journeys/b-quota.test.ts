import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asOwnerAs } from "../../packages/db/src/harness";
import { BudgetExceededError, GuardedProvider, SqlAiLedger } from "../../packages/pipeline/src/ai-guard";
import { readyDocFromText } from "../../packages/pipeline/src/fixtures";
import { generateQuiz } from "../../packages/pipeline/src/generate";
import { pgliteExecutor, pgliteRepository } from "../../packages/pipeline/src/pglite-repository";
import { QuotaExceededError } from "../../packages/pipeline/src/quota";
import { askDocument } from "../../packages/pipeline/src/rag";
import { Dim1536FakeProvider } from "../../packages/pipeline/src/test-utils";
import { kit, newDb } from "./helpers";

// Journey (b): FREE user hits the plan quota and the AI budget ceiling (structured errors, no model switch);
// admin grants PLUS with expiry -> limits change -> after expiry (clock helper) back to FREE.
let db: PGlite;
let k: ReturnType<typeof kit>;
let admin: string;
const models = { small: "m-small", standard: "m-standard", premium: "m-premium", embed: "m-embed" };
const adminSql = (sql: string, params: unknown[] = []) => asOwnerAs(db, admin, (tx) => tx.query<any>(sql, params));
const QUIZ = JSON.stringify({ questions: [{ prompt: "Q?", options: ["a", "b", "c", "d"], answer_index: 1, explanation: "e" }] });
const plan = async (u: string, at: string | null = null) => (await k.raw("select public.effective_plan($1, $2::timestamptz) p", [u, at]))[0]!.p as string;

beforeAll(async () => {
  db = await newDb();
  k = kit(db);
  admin = await k.user({ role: "admin" });
}, 120_000);
afterAll(async () => {
  await k.clearClock();
  await db.close();
});

describe("plan quota (FREE = 10 AI messages/day)", () => {
  it("11th question is a structured QuotaExceededError; PLUS grant lifts it; expiry returns to FREE", async () => {
    const repo = pgliteRepository(db);
    const u = await k.user();
    const doc = await readyDocFromText({ db, repo }, u, ["Fotosintez işığı kimyəvi enerjiyə çevirir."]);
    const provider = new Dim1536FakeProvider(() => "Cavab.");
    const deps = { repo, provider, models };
    for (let i = 0; i < 10; i++) await askDocument(deps, { userId: u, documentId: doc, question: `Sual ${i}?` });
    const err = await askDocument(deps, { userId: u, documentId: doc, question: "Sual 11?" }).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(QuotaExceededError);
    expect(err).toMatchObject({ code: "quota_exceeded", reason: "ai_messages_exceeded", limit: 10 });
    // no model switch: every chat call used the same model
    const chatModels = new Set(provider.calls.filter((c) => "prompt" in c).map((c) => c.model));
    expect(chatModels).toEqual(new Set(["m-small"]));

    // students cannot grant themselves a plan; the admin can, with an expiry
    expect(await plan(u)).toBe("free");
    await k.fails(u, "select public.admin_grant_plan($1, 'plus', now() + interval '10 days', 'self grant')", [u]);
    expect(await plan(u)).toBe("free");
    await k.run(admin, "select public.admin_grant_plan($1, 'plus', now() + interval '10 days', 'journey grant')", [u]);
    expect(await plan(u)).toBe("plus");
    // limits changed: the 11th question now succeeds and quiz (not in FREE) is allowed
    await expect(askDocument(deps, { userId: u, documentId: doc, question: "Sual 11?" })).resolves.toMatchObject({ grounded: expect.any(Boolean) });
    await expect(generateQuiz({ repo, provider: new Dim1536FakeProvider(() => QUIZ), models }, { userId: u, documentId: doc, count: 1 })).resolves.toBeTruthy();

    // time travel past the expiry (DB clock + injected JS clock)
    const later = new Date(Date.now() + 11 * 86400_000);
    await k.setClock(later.toISOString());
    try {
      expect(await plan(u)).toBe("free");
      await expect(
        generateQuiz({ repo, provider: new Dim1536FakeProvider(() => QUIZ), models, now: () => later }, { userId: u, documentId: doc, count: 2 }),
      ).rejects.toMatchObject({ reason: "feature_not_in_plan" });
    } finally {
      await k.clearClock();
    }
  }, 60_000);
});

describe("AI budget ceiling", () => {
  it("budget_exceeded is structured, never calls the provider and never switches model", async () => {
    const repo = pgliteRepository(db);
    const u = await k.user();
    const doc = await readyDocFromText({ db, repo }, u, ["Newton qanunları hərəkəti izah edir."]);
    // admin configures one provider, a premium primary with a cheaper approved fallback, routes and a tiny per-user budget
    const prov = (await adminSql("select public.admin_set_ai_provider('journey-prov', 'openai', true, null) as id")).rows[0].id;
    const model = async (name: string, tier: string, i: number, o: number, fb: boolean) =>
      (await adminSql("select public.admin_set_ai_model($1, $2, $3, $4, $5, 0, 1000, true, $6) as id", [prov, name, tier, i, o, fb])).rows[0].id as string;
    const big = await model("big", "premium", 3_000_000, 15_000_000, false);
    const small = await model("small", "small", 150_000, 600_000, true);
    const embedder = await model("embedder", "small", 20_000, 0, false);
    for (const task of ["chat", "rag"]) await adminSql("select public.admin_set_ai_route($1::public.ai_task, 'free', $2, $3::uuid[], 100)", [task, big, [small]]);
    await adminSql("select public.admin_set_ai_route('embed', 'free', $1, '{}', 1000)", [embedder]);
    await adminSql("select public.admin_set_ai_budget('global', '*', 'day', 1000000000)");
    await adminSql("select public.admin_set_ai_budget('user', '*', 'day', 1)"); // 1 micro-USD per user per day

    const provider = new Dim1536FakeProvider(() => "Cavab.");
    const guard = new GuardedProvider({ ledger: new SqlAiLedger(pgliteExecutor(db)), provider, sleep: async () => {}, random: () => 0.5 });
    const err = await askDocument({ repo, provider, models, guard }, { userId: u, documentId: doc, question: "Newton?" }).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect(err).toMatchObject({ code: "budget_exceeded" });
    // the (nearly free) embedding fit the budget; no chat call was made to any model, including the cheaper fallback
    expect(provider.calls.filter((c) => "prompt" in c)).toHaveLength(0);
    expect(new Set(provider.calls.map((c) => c.model))).toEqual(new Set(["embedder"]));
    expect(await k.raw("select 1 from public.ai_usage where user_id = $1 and task in ('chat','rag')", [u])).toEqual([]);
    // students cannot raise their own budget
    await k.fails(u, "select public.admin_set_ai_budget('user', '*', 'day', 999999999)");
  }, 60_000);
});
