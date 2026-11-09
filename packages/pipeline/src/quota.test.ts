import { PLANS } from "@unimate/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { affected, asUser, select } from "../../db/src/harness";
import { QuotaExceededError, consumeQuota } from "./quota";
import { createEnv, ids, type TestEnv } from "./test-utils";

let env: TestEnv;
beforeAll(async () => {
  env = await createEnv();
}, 120_000);
afterAll(async () => {
  await env.db.close();
});

const NOW = new Date("2026-03-15T12:00:00Z");
const settle = (ps: Promise<unknown>[]) => Promise.allSettled(ps);

describe("atomic quota", () => {
  it("parallel ai_message calls: exactly `limit` succeed (FREE = 10/day)", async () => {
    const limit = PLANS.FREE.aiMessagesPerDay;
    const results = await settle(Array.from({ length: limit + 15 }, () => consumeQuota(env.repo, ids.alice, "FREE", { type: "ai_message" }, NOW)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(limit);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(15);
    expect(rejected[0]!.reason).toBeInstanceOf(QuotaExceededError);
    expect(rejected[0]!.reason.reason).toBe("ai_messages_exceeded");
    expect((await env.repo.getUsage(ids.alice, NOW)).aiMessagesToday).toBe(limit);
  });

  it("first-row race: parallel first calls with limit 1 yield one winner", async () => {
    const rs = await Promise.all(Array.from({ length: 10 }, () => env.repo.bumpUsage(ids.bob, "upload_doc", "2026-03-01", 1)));
    expect(rs.filter((r) => r === 1)).toHaveLength(1);
    expect(rs.filter((r) => r === null)).toHaveLength(9);
  });

  it("limit 0 never admits", async () => {
    expect(await env.repo.bumpUsage(ids.bob, "ai_message", "2026-03-15", 0)).toBeNull();
  });

  it("monthly doc limit, and a new period resets the counter", async () => {
    const lim = PLANS.FREE.docsPerMonth;
    const uploads = Array.from({ length: lim + 2 }, () => consumeQuota(env.repo, ids.bob, "FREE", { type: "upload_doc", pages: 5 }, new Date("2026-04-10T00:00:00Z")));
    const rs = await settle(uploads);
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(lim);
    const next = await consumeQuota(env.repo, ids.bob, "FREE", { type: "upload_doc", pages: 5 }, new Date("2026-05-01T00:00:00Z"));
    expect(next).toBeTruthy();
  });

  it("static rules from checkQuota: pages and feature are denied without touching counters", async () => {
    const before = await env.repo.getUsage(ids.alice, new Date("2026-06-01T00:00:00Z"));
    await expect(consumeQuota(env.repo, ids.alice, "FREE", { type: "upload_doc", pages: PLANS.FREE.maxPages + 1 }, new Date("2026-06-01T00:00:00Z"))).rejects.toMatchObject({ reason: "pages_exceeded" });
    await expect(consumeQuota(env.repo, ids.alice, "FREE", { type: "use_feature", feature: "quiz" }, new Date("2026-06-01T00:00:00Z"))).rejects.toMatchObject({ reason: "feature_not_in_plan" });
    expect(await env.repo.getUsage(ids.alice, new Date("2026-06-01T00:00:00Z"))).toEqual(before);
  });

  it("release gives a unit back", async () => {
    const t = new Date("2026-07-01T00:00:00Z");
    const res = await consumeQuota(env.repo, ids.alice, "FREE", { type: "ai_message" }, t);
    expect((await env.repo.getUsage(ids.alice, t)).aiMessagesToday).toBe(1);
    await res.release();
    expect((await env.repo.getUsage(ids.alice, t)).aiMessagesToday).toBe(0);
    await res.release(); // never below zero
    expect((await env.repo.getUsage(ids.alice, t)).aiMessagesToday).toBe(0);
  });

  it("getPlan maps subscriptions (free default, plus, ignores expired)", async () => {
    expect(await env.repo.getPlan(ids.alice, NOW)).toBe("FREE");
    await env.db.query("insert into public.subscriptions (user_id, plan, status, current_period_start, current_period_end) values ($1, 'plus', 'active', '2026-03-01', '2026-04-01')", [ids.alice]);
    expect(await env.repo.getPlan(ids.alice, NOW)).toBe("PLUS");
    expect(await env.repo.getPlan(ids.alice, new Date("2026-05-01T00:00:00Z"))).toBe("FREE");
  });
});

describe("migration 20260101001400 privileges", () => {
  it("authenticated can read only own counters/cache and cannot write", async () => {
    await env.repo.bumpUsage(ids.alice, "ai_message", "2026-08-01", 5);
    await env.repo.bumpUsage(ids.bob, "ai_message", "2026-08-01", 5);
    const own = await select(env.db, "authenticated", ids.alice, "select user_id from public.usage_counters where period_start = '2026-08-01'");
    expect(own.map((r) => r.user_id)).toEqual([ids.alice]);
    expect(await affected(env.db, "authenticated", ids.alice, "update public.usage_counters set n = 0")).toBe(0);
    expect(await affected(env.db, "authenticated", ids.alice, "delete from public.usage_counters")).toBe(0);
    await expect(asUser(env.db, ids.alice, (tx) => tx.query("insert into public.usage_counters (user_id, kind, period_start, n) values ($1, 'ai_message', '2026-09-01', 0)", [ids.alice]))).rejects.toThrow(/permission denied/);
    expect(await select(env.db, "anon", null, "select * from public.generation_cache")).toEqual([]);
  });
});

describe("Reservation.release is idempotent", () => {
  it("repeated and concurrent release() gives back exactly one unit", async () => {
    const t = new Date("2026-08-01T12:00:00Z");
    const a = await consumeQuota(env.repo, ids.carol, "FREE", { type: "ai_message" }, t);
    await consumeQuota(env.repo, ids.carol, "FREE", { type: "ai_message" }, t);
    expect((await env.repo.getUsage(ids.carol, t)).aiMessagesToday).toBe(2);
    await Promise.all([a.release(), a.release()]);
    await a.release();
    expect((await env.repo.getUsage(ids.carol, t)).aiMessagesToday).toBe(1);
  });
});
