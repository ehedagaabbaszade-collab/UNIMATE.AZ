import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { affected, asAnon, asOwnerAs, asService, asUser, createTestDb, ids, seedFixtures, select } from "./harness";

// NOTE: PGlite is a single connection, so "parallel" calls here are queued one after another. The concurrency tests
// therefore prove the STATEMENT logic (check + update + insert are one unit, limits are exact), not true lock
// contention between separate Postgres backends.

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
  await seedFixtures(db);
}, 120_000);
afterAll(async () => {
  await db.close();
});

const A = ids.alice;
const B = ids.bob;
const C = ids.carol;
const MOD = ids.mod;
const ADMIN = ids.admin;

type R = Record<string, any>;
const raw = async (sql: string, params: unknown[] = []) => (await db.query<R>(sql, params)).rows;
const admin = async (sql: string, params: unknown[] = []) => (await asOwnerAs(db, ADMIN, (tx) => tx.query<R>(sql, params))).rows;
const svc = async (sql: string, params: unknown[] = []) => (await asService(db, (tx) => tx.query<R>(sql, params))).rows;
const n = (v: unknown) => Number(v);

const GLOBAL_BIG = 1_000_000_000;
let seq = 0;
const rid = (p = "req") => `${p}-${String(++seq).padStart(6, "0")}-${Math.random().toString(36).slice(2, 8)}`;

interface World {
  provider: string;
  big: string; // premium  3 / 15 / 0.3 USD per MTok
  mid: string; // standard 1 / 4 / 0.1, not approved as fallback
  small: string; // small 0.15 / 0.6 / 0.015, approved fallback
  small2: string; // small, approved fallback, same price as `small`
}
const setModel = (provider: string, name: string, tier: string, i: number, o: number, c: number, fb: boolean, max = 4096) =>
  admin("select public.admin_set_ai_model($1, $2, $3, $4, $5, $6, $7, true, $8) as id", [provider, name, tier, i, o, c, max, fb]).then((r) => r[0]!.id as string);

async function reset(): Promise<void> {
  for (const t of ["ai_rate_limits", "ai_reservations", "ai_spend", "ai_task_routes", "ai_budgets"]) await raw(`delete from public.${t}`);
  await raw("delete from public.ai_usage");
  await raw("delete from public.subscriptions");
  await raw("delete from public.ai_models");
  await raw("delete from public.ai_providers");
}
async function world(): Promise<World> {
  await reset();
  const provider = (await admin("select public.admin_set_ai_provider('prov-a', 'openai', true, 'test-label') as id"))[0]!.id as string;
  return {
    provider,
    big: await setModel(provider, "big-model", "premium", 3_000_000, 15_000_000, 300_000, false),
    mid: await setModel(provider, "mid-model", "standard", 1_000_000, 4_000_000, 100_000, false),
    small: await setModel(provider, "small-model", "small", 150_000, 600_000, 15_000, true),
    small2: await setModel(provider, "small-model-2", "small", 150_000, 600_000, 15_000, true),
  };
}
const budget = (scope: string, key: string, period: string, limit: number) =>
  admin("select public.admin_set_ai_budget($1, $2, $3, $4)", [scope, key, period, limit]);
const reserve = async (id: string, user: string, est: number, plan: string | null = null, task = "chat", model: string | null = null): Promise<R> =>
  (await svc("select public.reserve_ai_budget($1, $2, $3, $4, $5, $6) as r", [id, user, plan, est, task, model]))[0]!.r;
const settle = async (id: string, model: string | null, i: number | null, o: number | null, c = 0, status = "settled", fb = false): Promise<R> =>
  (await svc("select public.settle_ai_budget($1, $2, $3, $4, $5, $6, $7) as r", [id, model, i, o, c, status, fb]))[0]!.r;
const release = async (id: string): Promise<R> => (await svc("select public.release_ai_budget($1) as r", [id]))[0]!.r;
const spendRow = async (scope: string, key: string, period = "day") =>
  (await raw("select * from public.ai_spend where scope = $1 and key = $2 and period = $3", [scope, key, period]))[0];
const auditOf = (action: string) => raw("select * from public.audit_logs where action = $1 order by id", [action]);

describe("config RPCs: who may call what", () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
  });

  const adminCalls = (w: World): [string, string, unknown[]][] => [
    ["revert", "select public.admin_revert_config(1, 'because')", []],
    ["cost_breakdown", "select * from public.admin_ai_cost_breakdown(7, 'model')", []],
    ["top_spenders", "select * from public.admin_ai_top_spenders(7, 5)", []],
    ["utilisation", "select * from public.admin_ai_budget_utilisation()", []],
    ["failure_rates", "select * from public.admin_ai_failure_rates(7)", []],
    ["stuck", "select * from public.admin_ai_stuck_reservations(5)", []],
  ];
  it("students and moderators are rejected; anon has no execute", async () => {
    for (const [name, sql, params] of adminCalls(w)) {
      for (const uid of [A, MOD]) {
        await expect(asUser(db, uid, (tx) => tx.query(sql, params)), `${name} as ${uid}`).rejects.toThrow(/admin privileges required/);
      }
      await expect(asAnon(db, (tx) => tx.query(sql, params)), `${name} as anon`).rejects.toThrow(/permission denied/);
    }
  });
  it("service_role cannot call admin RPCs (no JWT admin) and users cannot call pipeline RPCs", async () => {
    await expect(asService(db, (tx) => tx.query("select public.admin_set_ai_budget('global', '*', 'day', 5)"))).rejects.toThrow(/permission denied/);
    const calls = [
      "select public.reserve_ai_budget('abcdefgh', '" + A + "', null, 1)",
      "select public.settle_ai_budget('abcdefgh', null, 1, 1)",
      "select public.release_ai_budget('abcdefgh')",
      "select public.ai_sweep_orphan_reservations(10)",
      "select public.ai_rate_limit_check('" + A + "', 'chat')",
      "select public.ai_load_config()",
    ];
    for (const sql of calls) {
      await expect(asUser(db, A, (tx) => tx.query(sql)), sql).rejects.toThrow(/permission denied/);
      await expect(asUser(db, ADMIN, (tx) => tx.query(sql)), `admin ${sql}`).rejects.toThrow(/permission denied/);
      await expect(asAnon(db, (tx) => tx.query(sql)), `anon ${sql}`).rejects.toThrow(/permission denied/);
    }
  });
  it("students cannot read or write config, spend, reservations, rate limits, versions", async () => {
    await budget("global", "*", "day", GLOBAL_BIG);
    await reserve(rid(), A, 10);
    for (const t of ["ai_providers", "ai_models", "ai_task_routes", "ai_budgets", "config_versions", "ai_spend", "ai_reservations", "ai_rate_limits"]) {
      expect(await select(db, "authenticated", A, `select * from public.${t}`), `read ${t}`).toEqual([]);
      expect(await select(db, "anon", null, `select * from public.${t}`), `anon read ${t}`).toEqual([]);
      expect(await affected(db, "authenticated", A, `delete from public.${t}`), `delete ${t}`).toBe(0);
      expect(await affected(db, "service_role", null, `delete from public.${t}`), `service delete ${t}`).toBe(0);
    }
    expect(await affected(db, "authenticated", A, "update public.ai_spend set spent_micro_usd = 0")).toBe(0);
    expect(await affected(db, "authenticated", A, "update public.ai_budgets set hard_limit_micro_usd = 10 ^ 12")).toBe(0);
    // admins read config directly (no secrets in it)
    expect((await select(db, "authenticated", ADMIN, "select * from public.ai_models")).length).toBe(4);
    expect((await select(db, "service_role", null, "select * from public.ai_models")).length).toBe(4);
  });
  it("students cannot write ai_usage or alter their plan; plan only comes from subscriptions", async () => {
    expect(await affected(db, "authenticated", A, "insert into public.ai_usage (user_id, feature) values ($1, 'chat')", [A])).toBe(0);
    await raw("insert into public.ai_usage (user_id, feature, request_id, cost_micro_usd) values ($1, 'chat', 'seeded-usage-1', 5)", [A]);
    expect(await affected(db, "authenticated", A, "update public.ai_usage set cost_micro_usd = 0 where user_id = $1", [A])).toBe(0);
    expect(await affected(db, "authenticated", A, "delete from public.ai_usage where user_id = $1", [A])).toBe(0);
    expect(await affected(db, "authenticated", A, "insert into public.subscriptions (user_id, plan) values ($1, 'pro')", [A])).toBe(0);
    expect(await affected(db, "authenticated", A, "update public.subscriptions set plan = 'pro' where user_id = $1", [A])).toBe(0);
    expect((await raw("select public.ai_plan_of($1) as p", [A]))[0]!.p).toBe("free");
    // a client cannot even read other users' usage rows
    expect(await select(db, "authenticated", B, "select * from public.ai_usage where user_id = $1", [A])).toEqual([]);
    // reserve cannot be tricked into a different plan
    await budget("global", "*", "day", GLOBAL_BIG);
    expect(await reserve(rid(), A, 1, "pro")).toEqual({ ok: false, error: "plan_mismatch" });
  });
});

describe("config validation, audit, versions, revert", () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
  });
  const bad = async (sql: string, params: unknown[], re: RegExp) => {
    await expect(admin(sql, params)).rejects.toThrow(re);
  };

  it("validates providers and models", async () => {
    await bad("select public.admin_set_ai_provider('Bad Name', 'openai', true)", [], /invalid provider name/);
    await bad("select public.admin_set_ai_provider('ok', 'mystery', true)", [], /unknown provider kind/);
    await bad("select public.admin_set_ai_provider('ok', 'openai', true, 'https://u:pw@host')", [], /label/);
    await bad("select public.admin_set_ai_provider('ok', 'openai', true, 'my-api-key')", [], /label/);
    const m = (i: unknown, o: unknown, c: unknown, tier = "small", max: unknown = 100, prov: unknown = w.provider) =>
      admin("select public.admin_set_ai_model($1, 'zz', $2, $3, $4, $5, $6, true, false)", [prov, tier, i, o, c, max]);
    await expect(m(0, 1, 0)).rejects.toThrow(/prices must be positive/);
    await expect(m(-5, 1, 0)).rejects.toThrow(/prices must be positive/);
    await expect(m(5, -1, 0)).rejects.toThrow(/prices must be positive/);
    await expect(m(5, 1, -1)).rejects.toThrow(/prices must be positive/);
    await expect(m(5, 1, 6)).rejects.toThrow(/cached input price cannot exceed/);
    await expect(m(5, 1, 1, "huge")).rejects.toThrow(/invalid tier/);
    await expect(m(5, 1, 1, "small", 0)).rejects.toThrow(/max_output_tokens/);
    await expect(m(5, 1, 1, "small", 100, ids.docA)).rejects.toThrow(/provider not found/);
    expect((await raw("select count(*)::int as c from public.ai_models where model = 'zz'"))[0]!.c).toBe(0);
  });

  it("validates routes: existence, approval, fallback cost ceiling, tier", async () => {
    const route = (primary: string, fb: string[], rate = 10) =>
      admin("select public.admin_set_ai_route('chat', 'free', $1, $2::uuid[], $3)", [primary, fb, rate]);
    await expect(route(ids.docA, [])).rejects.toThrow(/primary model not found/);
    await expect(route(w.big, [ids.docA])).rejects.toThrow(/fallback model not found/);
    await expect(route(w.big, [w.mid])).rejects.toThrow(/not approved/);
    await expect(route(w.big, [w.big])).rejects.toThrow(/fallback equals primary|not approved/);
    await expect(route(w.big, [w.small, w.small])).rejects.toThrow(/duplicate fallback/);
    await expect(route(w.big, [w.small], 0)).rejects.toThrow(/rate limit/);
    // pricier fallback than the primary is rejected
    const pricey = await setModel(w.provider, "pricey-fb", "small", 9_000_000, 9_000_000, 9_000_000, true);
    await expect(route(w.small, [pricey])).rejects.toThrow(/costs more than the primary/);
    // equal price is allowed; a higher tier at a lower price is not
    await route(w.small, [w.small2]);
    const upTier = await setModel(w.provider, "cheap-premium", "premium", 100_000, 100_000, 10_000, true);
    await expect(route(w.small, [upTier])).rejects.toThrow(/costs more than the primary/);
    // a later price edit that would make a configured fallback pricier is rejected too
    await expect(setModel(w.provider, "small-model-2", "small", 150_001, 600_000, 15_000, true)).rejects.toThrow(/costs more than the primary/);
    // ... and so is revoking approval of a configured fallback
    await expect(setModel(w.provider, "small-model-2", "small", 150_000, 600_000, 15_000, false)).rejects.toThrow(/not approved/);
    await route(w.big, [w.small, w.small2]);
    const cfg = (await svc("select public.ai_load_config() as c"))[0]!.c;
    expect(cfg.routes).toHaveLength(1);
    expect(cfg.routes[0].fallback_model_ids).toEqual([w.small, w.small2]);
  });

  it("validates budgets", async () => {
    await bad("select public.admin_set_ai_budget('global', '*', 'day', -1)", [], /non-negative/);
    await bad("select public.admin_set_ai_budget('global', 'x', 'day', 1)", [], /global budget key/);
    await bad("select public.admin_set_ai_budget('plan', 'gold', 'day', 1)", [], /plan budget key/);
    await bad("select public.admin_set_ai_budget('user', $1, 'day', 1)", [ids.docA], /user not found/);
    await bad("select public.admin_set_ai_budget('user', 'not-a-uuid', 'day', 1)", [], /user not found/);
    await bad("select public.admin_set_ai_budget('galaxy', '*', 'day', 1)", [], /invalid scope/);
    await bad("select public.admin_set_ai_budget('global', '*', 'week', 1)", [], /invalid period/);
    await budget("user", A, "day", 0); // zero is a valid hard limit
    await budget("user", "*", "month", 7);
  });

  it("audits every change with old and new values and keeps versions", async () => {
    const v0 = n((await raw("select coalesce(max(version), 0) as v from public.config_versions"))[0]!.v);
    await budget("global", "*", "day", 100);
    await budget("global", "*", "day", 250);
    const rows = await auditOf("ai_config.budget.set");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const last = rows[rows.length - 1]!;
    expect(last.actor_id).toBe(ADMIN);
    expect(last.metadata.old.hard_limit_micro_usd).toBe(100);
    expect(last.metadata.new.hard_limit_micro_usd).toBe(250);
    expect(n(last.metadata.version)).toBeGreaterThan(v0 + 1);
    const model = (await auditOf("ai_config.model.set")).pop()!;
    expect(model.metadata.new.model).toBe("small-model-2");
    expect(JSON.stringify(model.metadata)).not.toMatch(/api[_-]?key|secret/i);
    // failed (rejected) writes leave neither a version nor an audit row
    const before = n((await raw("select count(*) as c from public.config_versions"))[0]!.c);
    const auditBefore = n((await raw("select count(*) as c from public.audit_logs"))[0]!.c);
    await expect(budget("global", "*", "day", -5)).rejects.toThrow();
    expect(n((await raw("select count(*) as c from public.config_versions"))[0]!.c)).toBe(before);
    expect(n((await raw("select count(*) as c from public.audit_logs"))[0]!.c)).toBe(auditBefore);
  });

  it("reverts to an earlier version (audited, validated, recorded as a new version)", async () => {
    await budget("global", "*", "day", 100);
    const v1 = n((await raw("select max(version) as v from public.config_versions"))[0]!.v);
    await admin("select public.admin_set_ai_route('chat', 'free', $1, $2::uuid[], 5)", [w.big, [w.small]]);
    await budget("global", "*", "day", 999);
    await setModel(w.provider, "extra-model", "small", 1, 1, 1, false);
    expect((await raw("select count(*)::int as c from public.ai_task_routes"))[0]!.c).toBe(1);

    await expect(admin("select public.admin_revert_config($1, 'x')", [v1])).rejects.toThrow(/reason/);
    await expect(admin("select public.admin_revert_config(999999, 'valid reason')", [])).rejects.toThrow(/not found/);
    const v = n((await admin("select public.admin_revert_config($1, 'undo experiment') as v", [v1]))[0]!.v);
    expect(v).toBeGreaterThan(v1);
    expect((await raw("select hard_limit_micro_usd from public.ai_budgets where scope = 'global'"))[0]!.hard_limit_micro_usd).toBe(100);
    expect((await raw("select count(*)::int as c from public.ai_task_routes"))[0]!.c).toBe(0);
    expect((await raw("select count(*)::int as c from public.ai_models where model = 'extra-model'"))[0]!.c).toBe(0);
    expect((await raw("select count(*)::int as c from public.ai_models"))[0]!.c).toBe(4);
    const a = (await auditOf("ai_config.revert")).pop()!;
    expect(a.actor_id).toBe(ADMIN);
    expect(n(a.metadata.reverted_to)).toBe(v1);
    expect(a.metadata.reason).toBe("undo experiment");
    expect(n(a.metadata.version)).toBe(v);
    // the current state is a snapshot too, and reverting forward again works
    const v2 = n((await admin("select public.admin_revert_config($1, 'redo it') as v", [v]))[0]!.v);
    expect(v2).toBeGreaterThan(v);
  });
});

describe("revert keeps history", () => {
  it("does not null ai_usage/reservation model ids and round-trips routes with fallback arrays", async () => {
    const w = await world();
    await budget("global", "*", "day", GLOBAL_BIG);
    await admin("select public.admin_set_ai_route('chat', 'free', $1, $2::uuid[], 9)", [w.big, [w.small, w.small2]]);
    const v = n((await raw("select max(version) as v from public.config_versions"))[0]!.v);
    const done = rid();
    const open = rid();
    await reserve(done, A, 5_000, null, "chat", w.small);
    await settle(done, w.small, 100, 100);
    await reserve(open, A, 5_000, null, "chat", w.big);
    // change things, including a model that is NOT in the snapshot
    const extra = await setModel(w.provider, "temp-model", "small", 1, 1, 1, false);
    await admin("select public.admin_set_ai_route('chat', 'free', $1, '{}', 3)", [extra]);
    await budget("global", "*", "day", 5);
    await admin("select public.admin_revert_config($1, 'back to known good')", [v]);
    expect((await raw("select model_id from public.ai_usage where request_id = $1", [done]))[0]!.model_id).toBe(w.small);
    expect((await raw("select model_id from public.ai_reservations where request_id = $1", [open]))[0]!.model_id).toBe(w.big);
    const route = (await raw("select * from public.ai_task_routes where task = 'chat' and plan = 'free'"))[0]!;
    expect(route.primary_model_id).toBe(w.big);
    expect(route.fallback_model_ids).toEqual([w.small, w.small2]);
    expect(route.rate_limit_per_min).toBe(9);
    expect((await raw("select count(*)::int as c from public.ai_models where model = 'temp-model'"))[0]!.c).toBe(0);
    expect((await raw("select count(*)::int as c from public.ai_models"))[0]!.c).toBe(4);
    expect(n((await raw("select hard_limit_micro_usd as h from public.ai_budgets where scope = 'global'"))[0]!.h)).toBe(GLOBAL_BIG);
  });
});

describe("budget reservations", () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
    await budget("global", "*", "day", GLOBAL_BIG);
  });

  it("no config => structured ai_not_configured (never unlimited)", async () => {
    await raw("delete from public.ai_budgets");
    expect(await reserve(rid(), A, 1)).toEqual({ ok: false, error: "ai_not_configured", reason: "no_global_budget" });
    await raw("delete from public.ai_task_routes");
    expect(await svc("select public.ai_rate_limit_check($1, 'chat') as r", [A])).toEqual([
      { r: { ok: false, error: "ai_not_configured", reason: "no_route" } },
    ]);
    expect((await svc("select public.ai_load_config() as c"))[0]!.c.routes).toEqual([]);
  });

  it("rejects at the limit with a structured budget_exceeded naming the scope", async () => {
    await budget("user", A, "day", 100);
    expect((await reserve(rid(), A, 60)).ok).toBe(true);
    expect(await reserve(rid(), A, 60)).toEqual({ ok: false, error: "budget_exceeded", scope: "user", period: "day" });
    expect((await reserve(rid(), B, 60)).ok).toBe(true); // another user is unaffected
    await budget("plan", "free", "day", 150);
    expect(await reserve(rid(), C, 50)).toEqual({ ok: false, error: "budget_exceeded", scope: "plan", period: "day" });
    // inconsistent (plan > global) configs are refused by the RPC now; the ledger must still enforce one if it exists
    await raw("insert into public.ai_budgets (scope, key, period, hard_limit_micro_usd) values ('global', '*', 'day', 130) on conflict (scope, key, period) do update set hard_limit_micro_usd = 130");
    expect(await reserve(rid(), C, 20)).toEqual({ ok: false, error: "budget_exceeded", scope: "global", period: "day" });
    // a rejected attempt reserved nothing anywhere
    expect(n((await spendRow("global", "*"))!.reserved_micro_usd)).toBe(120);
    expect(n((await spendRow("plan", "free"))!.reserved_micro_usd)).toBe(120);
    expect(await reserve(rid(), C, 10)).toMatchObject({ ok: true });
    expect(await reserve(rid(), C, 1)).toMatchObject({ ok: false, scope: "global" });
  });

  it("monthly limits apply independently of daily ones; user '*' default and per-user override", async () => {
    await budget("user", "*", "day", 100);
    await budget("user", A, "day", 300); // override for alice
    await budget("global", "*", "month", 400);
    expect((await reserve(rid(), A, 200)).ok).toBe(true);
    expect(await reserve(rid(), B, 120)).toMatchObject({ ok: false, scope: "user" }); // default 100
    expect((await reserve(rid(), B, 100)).ok).toBe(true);
    expect((await reserve(rid(), A, 100)).ok).toBe(true);
    expect(await reserve(rid(), A, 1)).toMatchObject({ ok: false, scope: "global", period: "month" }); // 400 total
  });

  it("a limit added mid-period still counts earlier spend", async () => {
    expect((await reserve(rid(), A, 80)).ok).toBe(true);
    await budget("user", A, "month", 100);
    expect(await reserve(rid(), A, 30)).toMatchObject({ ok: false, scope: "user", period: "month" });
  });

  it("is idempotent per request_id: same id never double-reserves or double-bills", async () => {
    await budget("user", A, "day", 100);
    const id = rid();
    expect(await reserve(id, A, 60)).toMatchObject({ ok: true, existing: false, status: "reserved" });
    expect(await reserve(id, A, 60)).toMatchObject({ ok: true, existing: true, status: "reserved" });
    expect(await reserve(id, A, 60)).toMatchObject({ ok: true, existing: true });
    expect(n((await spendRow("user", A))!.reserved_micro_usd)).toBe(60);
    expect(await reserve(id, B, 60)).toEqual({ ok: false, error: "request_id_conflict" });
    expect(await settle(id, w.small, 1000, 500)).toMatchObject({ ok: true, already: false, actual_micro_usd: 450, clamped: true });
    // settle again (a retry): no second deduction, no second ai_usage row
    expect(await settle(id, w.small, 1000, 500)).toMatchObject({ ok: true, already: true });
    expect(await reserve(id, A, 60)).toMatchObject({ ok: true, existing: true, status: "settled" });
    const s = (await spendRow("user", A))!;
    expect(n(s.spent_micro_usd)).toBe(450); // uncapped actual (reserved 60)
    expect(n(s.reserved_micro_usd)).toBe(0);
    expect((await raw("select * from public.ai_usage where request_id = $1", [id])).length).toBe(1);
  });

  it("settles to measured usage (cached tokens priced separately), refunds the unused reservation", async () => {
    await budget("user", A, "day", 100_000);
    const id = rid();
    await reserve(id, A, 5_000, null, "summarize", w.small);
    // small: 150k in, 15k cached, 600k out per MTok: 8000 fresh*0.15 + 2000 cached*0.015 + 1000 out*0.6 = 1200+30+600
    const r = await settle(id, w.small, 10_000, 1_000, 2_000);
    expect(r).toMatchObject({ ok: true, actual_micro_usd: 1830, clamped: false });
    const s = (await spendRow("user", A))!;
    expect([n(s.spent_micro_usd), n(s.reserved_micro_usd)]).toEqual([1830, 0]);
    expect(n((await spendRow("global", "*"))!.spent_micro_usd)).toBe(1830);
    const u = (await raw("select * from public.ai_usage where request_id = $1", [id]))[0]!;
    expect(u).toMatchObject({
      provider: "prov-a", task: "summarize", model: "small-model", plan: "free", status: "settled",
      input_tokens: 10_000, output_tokens: 1_000, cached_input_tokens: 2_000, fallback_used: false,
    });
    expect(n(u.cost_micro_usd)).toBe(1830);
    expect(n(u.estimated_cost_micro_usd)).toBe(5000);
    expect(u.model_id).toBe(w.small);
  });

  it("records the UNCAPPED actual above the reservation, flags it, and the next reserve fails at the ceiling", async () => {
    await budget("user", A, "day", 100_000);
    const id = rid();
    await reserve(id, A, 100, null, "chat", w.big);
    const r = await settle(id, w.big, 100_000, 100_000); // would cost 1.8M
    expect(r).toMatchObject({ ok: true, actual_micro_usd: 1_800_000, clamped: true });
    expect(n((await spendRow("user", A))!.spent_micro_usd)).toBe(1_800_000);
    expect((await raw("select clamped, actual_micro_usd from public.ai_reservations where request_id = $1", [id]))[0]).toMatchObject({ clamped: true });
    expect(await reserve(rid(), A, 1)).toMatchObject({ ok: false, error: "budget_exceeded", scope: "user", period: "day" });
  });

  it("billable failure without measured usage settles at the reserved estimate (failed_billable)", async () => {
    await budget("user", A, "day", 1000);
    const id = rid();
    await reserve(id, A, 400, null, "chat", w.small);
    expect(await settle(id, null, null, null, 0, "failed_billable")).toMatchObject({ ok: true, actual_micro_usd: 400 });
    expect(n((await spendRow("user", A))!.spent_micro_usd)).toBe(400);
    const u = (await raw("select status, cost_micro_usd from public.ai_usage where request_id = $1", [id]))[0]!;
    expect(u.status).toBe("failed_billable");
    expect(n(u.cost_micro_usd)).toBe(400);
    await expect(settle(rid(), null, 1, 1, 0, "oops")).rejects.toThrow(/invalid status/);
  });

  it("release gives capacity back, is idempotent, and a released id cannot be settled", async () => {
    await budget("user", A, "day", 100);
    const id = rid();
    await reserve(id, A, 100, null, "chat", w.small);
    expect(await reserve(rid(), A, 1)).toMatchObject({ ok: false, scope: "user" });
    expect(await release(id)).toMatchObject({ ok: true, released: true, status: "released" });
    expect(await release(id)).toMatchObject({ ok: true, released: false, status: "released" });
    expect(n((await spendRow("user", A))!.reserved_micro_usd)).toBe(0);
    expect(await settle(id, null, null, null, 0, "failed_billable")).toEqual({ ok: false, error: "reservation_released" });
    const rows = await raw("select status, cost_micro_usd from public.ai_usage where request_id = $1", [id]);
    expect(rows).toEqual([{ status: "failed_unbilled", cost_micro_usd: 0 }]);
    expect((await reserve(rid(), A, 100)).ok).toBe(true);
    // never-seen id: release reports not-ok instead of throwing
    expect(await release("never-reserved-id")).toMatchObject({ ok: false });
  });

  it("re-reserving a released request_id works once, settles over the failed_unbilled row, still one usage row", async () => {
    await budget("user", A, "day", 1000);
    const id = rid();
    await reserve(id, A, 300, null, "chat", w.small);
    await release(id);
    expect(await reserve(id, A, 300, null, "chat", w.small)).toMatchObject({ ok: true, existing: false });
    expect(await reserve(id, A, 300, null, "chat", w.small)).toMatchObject({ ok: true, existing: true });
    expect(n((await spendRow("user", A))!.reserved_micro_usd)).toBe(300);
    await settle(id, w.small, 100, 100);
    const rows = await raw("select status from public.ai_usage where request_id = $1", [id]);
    expect(rows).toEqual([{ status: "settled" }]);
  });

  it("a RELEASED request_id cannot be taken over by another user (no charge to B, owner unchanged)", async () => {
    await budget("user", A, "day", 1000);
    await budget("user", B, "day", 1000);
    const id = rid();
    await reserve(id, A, 300, null, "chat", w.small);
    await release(id);
    expect(await reserve(id, B, 300, null, "chat", w.small)).toEqual({ ok: false, error: "request_id_conflict" });
    expect((await raw("select user_id, status from public.ai_reservations where request_id = $1", [id]))[0]).toMatchObject({ user_id: A, status: "released" });
    expect(n((await spendRow("user", B))?.reserved_micro_usd ?? 0)).toBe(0);
  });

  it("the sweeper settles (bills the estimate as failed_billable) only reservations older than the threshold; stuck view lists them", async () => {
    await budget("user", A, "day", 1000);
    const old = rid();
    const fresh = rid();
    await reserve(old, A, 100, null, "chat", w.small);
    await reserve(fresh, A, 100, null, "chat", w.small);
    await raw("update public.ai_reservations set created_at = now() - interval '2 hours' where request_id = $1", [old]);
    const stuck = await admin("select * from public.admin_ai_stuck_reservations(30)");
    expect(stuck.map((r) => r.request_id)).toEqual([old]);
    expect(stuck[0]).not.toHaveProperty("prompt");
    await expect(svc("select public.ai_sweep_orphan_reservations(1)")).rejects.toThrow(/at least 5/);
    expect((await svc("select public.ai_sweep_orphan_reservations(30) as n"))[0]!.n).toBe(1);
    expect((await svc("select public.ai_sweep_orphan_reservations(30) as n"))[0]!.n).toBe(0);
    expect(n((await spendRow("user", A))!.reserved_micro_usd)).toBe(100);
    expect(n((await spendRow("user", A))!.spent_micro_usd)).toBe(100); // estimate charged, not refunded
    const st = await raw("select request_id, status from public.ai_reservations order by request_id");
    expect(Object.fromEntries(st.map((r) => [r.request_id, r.status]))).toEqual({ [old]: "settled", [fresh]: "reserved" });
    expect(await raw("select status, cost_micro_usd::int c from public.ai_usage where request_id = $1", [old])).toEqual([{ status: "failed_billable", c: 100 }]);
  });

  it("validates inputs", async () => {
    await expect(reserve("short", A, 1)).rejects.toThrow(/invalid request_id/);
    await expect(reserve(rid(), A, -1)).rejects.toThrow(/non-negative/);
    await expect(reserve(rid(), ids.docA, 1)).rejects.toThrow(/user not found/);
  });

  it("plan is derived from subscriptions (pro user is charged to the pro plan budget)", async () => {
    await raw("insert into public.subscriptions (user_id, plan, status) values ($1, 'pro', 'active')", [B]);
    await budget("plan", "pro", "day", 50);
    expect(await reserve(rid(), B, 100, "PRO")).toMatchObject({ ok: false, scope: "plan" });
    expect(await reserve(rid(), B, 40, "pro")).toMatchObject({ ok: true });
    expect(n((await spendRow("plan", "pro"))!.reserved_micro_usd)).toBe(40);
    expect(await spendRow("plan", "free")).toBeUndefined();
  });
});

describe("concurrent reservations: exactly N succeed (statement logic on single-connection PGlite)", () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
    await budget("global", "*", "day", GLOBAL_BIG);
  });
  const burst = async (users: string[], k: number, est: number) =>
    Promise.all(Array.from({ length: k }, (_, i) => reserve(rid("burst"), users[i % users.length]!, est, null, "chat", w.small)));
  const summarize = (rs: R[]) => ({
    ok: rs.filter((r) => r.ok).length,
    denied: rs.filter((r) => !r.ok).map((r) => r.scope),
  });

  it("per user", async () => {
    await budget("user", A, "day", 700);
    const s = summarize(await burst([A], 30, 100));
    expect(s.ok).toBe(7);
    expect(new Set(s.denied)).toEqual(new Set(["user"]));
    expect(n((await spendRow("user", A))!.reserved_micro_usd)).toBe(700);
  });
  it("per plan (spread over several users)", async () => {
    await budget("plan", "free", "day", 900);
    const s = summarize(await burst([A, B, C], 30, 100));
    expect(s.ok).toBe(9);
    expect(new Set(s.denied)).toEqual(new Set(["plan"]));
    expect(n((await spendRow("plan", "free"))!.reserved_micro_usd)).toBe(900);
  });
  it("global", async () => {
    await budget("global", "*", "day", 1100);
    const s = summarize(await burst([A, B, C], 30, 100));
    expect(s.ok).toBe(11);
    expect(new Set(s.denied)).toEqual(new Set(["global"]));
    expect(n((await spendRow("global", "*"))!.reserved_micro_usd)).toBe(1100);
  });
  it("same request_id fired 30 times reserves once", async () => {
    await budget("user", A, "day", 10_000);
    const id = rid("same");
    const rs = await Promise.all(Array.from({ length: 30 }, () => reserve(id, A, 100, null, "chat", w.small)));
    expect(rs.filter((r) => r.existing === false)).toHaveLength(1);
    expect(n((await spendRow("user", A))!.reserved_micro_usd)).toBe(100);
    expect((await raw("select count(*)::int as c from public.ai_reservations where request_id = $1", [id]))[0]!.c).toBe(1);
  });
  it("reserve/settle/release interleaved keep spent + reserved <= limit", async () => {
    await budget("user", A, "day", 500);
    const ids5 = Array.from({ length: 12 }, () => rid("mix"));
    const got = await Promise.all(ids5.map((id) => reserve(id, A, 100, null, "chat", w.small)));
    const okIds = ids5.filter((_, i) => got[i]!.ok);
    expect(okIds).toHaveLength(5);
    await Promise.all(okIds.map((id, i) => (i % 2 ? settle(id, w.small, 100, 100) : release(id))));
    const s = (await spendRow("user", A))!;
    expect(n(s.reserved_micro_usd)).toBe(0);
    expect(n(s.spent_micro_usd)).toBeLessThanOrEqual(500);
    expect(n(s.spent_micro_usd)).toBe(2 * 75); // 100*0.15 + 100*0.6 = 75 micro-USD each, two settled
  });
});

describe("rate limit", () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
    await admin("select public.admin_set_ai_route('chat', 'free', $1, '{}', 3)", [w.small]);
    await admin("select public.admin_set_ai_route('chat', 'plus', $1, '{}', 50)", [w.small]);
  });
  const rl = async (u: string, task = "chat"): Promise<R> => (await svc("select public.ai_rate_limit_check($1, $2) as r", [u, task]))[0]!.r;
  it("allows N per minute per user+task, then rate_limited with retry_after; window resets", async () => {
    const rs = await Promise.all(Array.from({ length: 10 }, () => rl(A)));
    expect(rs.filter((r) => r.ok)).toHaveLength(3);
    const denied = rs.find((r) => !r.ok)!;
    expect(denied.error).toBe("rate_limited");
    expect(denied.retry_after_seconds).toBeGreaterThanOrEqual(1);
    expect(denied.retry_after_seconds).toBeLessThanOrEqual(60);
    expect((await rl(B)).ok).toBe(true); // another user
    expect(await rl(A, "quiz")).toMatchObject({ ok: false, error: "ai_not_configured" }); // no route for that task
    await raw("update public.ai_rate_limits set window_start = window_start - interval '2 minutes'");
    expect(await rl(A)).toMatchObject({ ok: true, n: 1 });
    // plan decides the limit
    await raw("insert into public.subscriptions (user_id, plan, status) values ($1, 'plus', 'active')", [C]);
    const many = await Promise.all(Array.from({ length: 20 }, () => rl(C)));
    expect(many.every((r) => r.ok)).toBe(true);
  });
});

describe("admin cost views (aggregates only)", () => {
  it("break down cost by day/model/provider/task/plan, top spenders, utilisation, failure and fallback rates", async () => {
    const w = await world();
    await budget("global", "*", "day", 10_000);
    await budget("user", "*", "day", 1_000);
    await budget("plan", "free", "day", 5_000);
    const a = rid(), b = rid(), c = rid(), d = rid();
    await reserve(a, A, 500, null, "chat", w.small);
    await settle(a, w.small, 1000, 500); // 450
    await reserve(b, A, 500, null, "summarize", w.big);
    await settle(b, null, null, null, 0, "failed_billable"); // 500
    await reserve(c, B, 300, null, "chat", w.small);
    await settle(c, w.small2, 100, 100, 0, "settled", true); // 75 on small-model-2, fallback
    await reserve(d, B, 300, null, "chat", w.small);
    await release(d);

    const by = async (g: string): Promise<Record<string, number[]>> => Object.fromEntries((await admin("select * from public.admin_ai_cost_breakdown(30, $1)", [g])).map((r) => [r.bucket, [n(r.requests), n(r.cost_micro_usd)]]));
    expect(await by("model")).toEqual({ "small-model": [1, 450], "big-model": [1, 500], "small-model-2": [1, 75] });
    expect(await by("task")).toEqual({ chat: [2, 525], summarize: [1, 500] });
    expect(await by("provider")).toEqual({ "prov-a": [3, 1025] });
    expect(await by("plan")).toEqual({ free: [3, 1025] });
    expect(Object.values(await by("day")).reduce((s: number, v) => s + (v[1] as number), 0)).toBe(1025);
    await expect(admin("select * from public.admin_ai_cost_breakdown(30, 'email')")).rejects.toThrow(/group must be/);

    const top = await admin("select * from public.admin_ai_top_spenders(30, 5)");
    expect(top.map((r) => [r.user_id, n(r.cost_micro_usd)])).toEqual([[A, 950], [B, 75]]);
    expect(Object.keys(top[0]!).sort()).toEqual(["cost_micro_usd", "requests", "user_id"]);

    const util = await admin("select * from public.admin_ai_budget_utilisation()");
    const g = util.find((r) => r.scope === "global")!;
    expect([n(g.spent_micro_usd), n(g.hard_limit_micro_usd)]).toEqual([1025, 10_000]);
    expect(n(g.utilisation_pct)).toBe(10.25);
    expect(n(util.find((r) => r.scope === "user")!.spent_micro_usd)).toBe(950); // most-used user

    const fr = (await admin("select * from public.admin_ai_failure_rates(30)")).find((r) => r.task === "chat")!;
    expect([n(fr.requests), n(fr.failed_billable), n(fr.failed_unbilled), n(fr.fallback_used)]).toEqual([3, 0, 1, 1]);
    const sm = (await admin("select * from public.admin_ai_failure_rates(30)")).find((r) => r.task === "summarize")!;
    expect(n(sm.failed_billable)).toBe(1);
  });
});

describe("legacy ai_usage compatibility", () => {
  it("old-style inserts still work (new columns are defaulted) and request_id is unique", async () => {
    await raw("insert into public.ai_usage (user_id, feature, model, input_tokens, output_tokens, cost_micro_usd) values ($1, 'chat', 'm', 1, 1, 1)", [A]);
    await raw("insert into public.ai_usage (user_id, feature, model, input_tokens, output_tokens, cost_micro_usd) values ($1, 'chat', 'm', 1, 1, 1)", [A]);
    const r = (await raw("select status, cached_input_tokens, request_id from public.ai_usage where user_id = $1 limit 1", [A]))[0]!;
    expect(r).toMatchObject({ status: "settled", cached_input_tokens: 0, request_id: null });
    await raw("insert into public.ai_usage (user_id, feature, request_id) values ($1, 'x', 'unique-req-1')", [A]);
    await expect(raw("insert into public.ai_usage (user_id, feature, request_id) values ($1, 'x', 'unique-req-1')", [A])).rejects.toThrow(/duplicate key/);
  });
});
