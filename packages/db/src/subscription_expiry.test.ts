import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { affected, asAnon, asService, asUser, createTestDb, ids, migrationFiles, seedFixtures, select } from "./harness";

// Migration 20260101003400: effective_plan, expiry sweeper, mandatory grant expiry. Time travel via app_private.clock_override.
let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
  await seedFixtures(db);
}, 120_000);
afterAll(async () => {
  await db.close();
});

const raw = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows;
const run = (uid: string, sql: string, params: unknown[] = []) => asUser(db, uid, (tx) => tx.query<Record<string, any>>(sql, params));
let n = 0;
const newUser = async () => {
  n++;
  const id = `00000000-0000-4000-8000-0000004${String(n).padStart(5, "0")}`;
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `se${n}@example.test`]);
  return id;
};
const setClock = (iso: string) => raw("insert into app_private.clock_override (at) values ($1) on conflict (singleton) do update set at = excluded.at", [iso]);
const clearClock = () => raw("delete from app_private.clock_override");
const plan = async (u: string, at: string | null = null) => (await raw("select public.effective_plan($1, $2::timestamptz) p", [u, at]))[0]!.p as string;
const sub = (u: string, p: string, status: string, end: string | null, extra = "") =>
  raw(`insert into public.subscriptions (user_id, plan, status, current_period_start, current_period_end ${extra ? ", " + extra.split("|")[0] : ""}) values ($1, $2::public.sub_plan, $3::public.sub_status, '2020-01-01', $4 ${extra ? ", " + extra.split("|")[1] : ""})`, [u, p, status, end]);

describe("effective_plan", () => {
  it("active/trialing with null or future expiry count; expired, past_due, canceled, expired-status do not", async () => {
    const cases: [string, string, string | null, string][] = [
      ["plus", "active", null, "plus"],
      ["pro", "active", "2999-01-01", "pro"],
      ["plus", "trialing", "2999-01-01", "plus"],
      ["pro", "active", "2020-06-01", "free"],
      ["pro", "past_due", "2999-01-01", "free"],
      ["pro", "canceled", "2999-01-01", "free"],
      ["pro", "expired", "2999-01-01", "free"],
    ];
    for (const [p, status, end, expected] of cases) {
      const u = await newUser();
      await sub(u, p, status, end);
      expect(await plan(u), `${p}/${status}/${end}`).toBe(expected);
    }
    expect(await plan(await newUser())).toBe("free");
  });

  it("an explicit evaluation time and the injectable clock both move the answer", async () => {
    const u = await newUser();
    await sub(u, "plus", "active", "2030-01-01");
    expect(await plan(u, "2029-12-31T23:59:59Z")).toBe("plus");
    expect(await plan(u, "2030-01-01T00:00:00Z")).toBe("free"); // boundary: expires_at must be > now
    try {
      await setClock("2029-06-01T00:00:00Z");
      expect(await plan(u)).toBe("plus");
      await setClock("2030-06-01T00:00:00Z");
      expect(await plan(u)).toBe("free");
      expect((await raw("select public.ai_plan_of($1) p", [u]))[0]!.p).toBe("free"); // budget / route path
    } finally {
      await clearClock();
    }
  });

  it("the highest live plan wins", async () => {
    const u = await newUser();
    await sub(u, "plus", "active", null);
    await db.query("update public.subscriptions set status = 'canceled' where user_id = $1", [u]);
    await sub(u, "pro", "trialing", "2999-01-01");
    expect(await plan(u)).toBe("pro");
  });

  it("a manual subscription without expiry cannot exist (constraint), a paid one may be open-ended", async () => {
    const u = await newUser();
    await expect(sub(u, "pro", "active", null, "source, granted_by, grant_reason|'manual', null, 'gift'")).rejects.toThrow(/subscriptions_manual_has_expiry/);
    await sub(u, "pro", "active", null); // paid, null = provider managed
    expect(await plan(u)).toBe("pro");
  });

  it("API roles cannot ask for other users' plans; users read their own through my_plan()", async () => {
    const u = await newUser();
    const v = await newUser();
    await sub(u, "pro", "active", "2999-01-01");
    await expect(run(v, "select public.effective_plan($1)", [u])).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, (tx) => tx.query("select public.effective_plan($1)", [u]))).rejects.toThrow(/permission denied/);
    expect((await run(u, "select public.my_plan() p")).rows[0]!.p).toBe("pro");
    expect((await run(v, "select public.my_plan() p")).rows[0]!.p).toBe("free");
    expect((await asService(db, (tx) => tx.query<any>("select public.effective_plan($1) p", [u]))).rows[0]!.p).toBe("pro");
  });
});

describe("admin_grant_plan requires a validated future expiry", () => {
  const grant = (actor: string, target: string, plan: string, until: string | null, reason = "support gift") =>
    run(actor, `select public.admin_grant_plan($1, $2::public.sub_plan, ${until ?? "null::timestamptz"}, $3) as id`, [target, plan, reason]);

  it("null / past / >1 year (admin) rejected; <=1 year accepted; super_admin may exceed 1 year; students denied first", async () => {
    const u = await newUser();
    await expect(grant(ids.admin, u, "pro", null)).rejects.toThrow(/until is required/);
    await expect(grant(ids.admin, u, "pro", "now() - interval '1 hour'")).rejects.toThrow(/future/);
    await expect(grant(ids.admin, u, "pro", "now() + interval '400 days'")).rejects.toThrow(/at most 1 year/);
    await expect(grant(ids.alice, u, "pro", null)).rejects.toThrow(/admin privileges required/);
    expect(await plan(u)).toBe("free");
    await grant(ids.admin, u, "pro", "now() + interval '360 days'");
    expect(await plan(u)).toBe("pro");
    await grant(ids.superAdmin, u, "plus", "now() + interval '800 days'");
    const s = (await raw("select plan, expires_at, source from public.subscriptions where user_id = $1 and status = 'active'", [u]))[0]!;
    expect(s).toMatchObject({ plan: "plus", source: "manual" });
    expect(s.expires_at).not.toBeNull();
    // free = revoke needs no expiry
    await grant(ids.admin, u, "free", null);
    expect(await plan(u)).toBe("free");
  });
});

describe("admin_grant_plan over a lapsed-but-unswept paid row", () => {
  it("settles the lapsed row (expired + audited) instead of failing on subscriptions_one_live", async () => {
    const u = await newUser();
    await sub(u, "plus", "active", "2020-06-01");
    await run(ids.admin, "select public.admin_grant_plan($1, 'pro', now() + interval '10 days', 'replace lapsed')", [u]);
    const rows = await raw("select plan, status from public.subscriptions where user_id = $1 order by plan", [u]);
    expect(rows).toEqual([{ plan: "plus", status: "expired" }, { plan: "pro", status: "active" }]);
    expect(await plan(u)).toBe("pro");
    const old = (await raw("select id from public.subscriptions where user_id = $1 and plan = 'plus'", [u]))[0]!.id;
    expect((await raw("select count(*)::int c from public.audit_logs where action = 'subscription.expired' and entity_id = $1", [old]))[0]!.c).toBe(1);
  });
});

describe("the injectable clock cannot be touched by API roles", () => {
  it("select/insert/update/delete on app_private.clock_override are denied; now_utc() still works", async () => {
    const u = await newUser();
    for (const role of ["authenticated", "anon", "service_role"] as const) {
      const uid = role === "authenticated" ? u : null;
      for (const sql of ["select * from app_private.clock_override", "insert into app_private.clock_override (at) values ('2000-01-01')", "update app_private.clock_override set at = now()", "delete from app_private.clock_override"])
        await expect(db.transaction(async (tx) => { await tx.exec(`set local role ${role}`); await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [uid ?? ""]); return tx.query(sql); }), `${role}: ${sql}`).rejects.toThrow(/permission denied/);
    }
    expect((await run(u, "select public.now_utc() t")).rows[0]!.t).toBeInstanceOf(Date);
    // a GUC cannot move it either
    const t = (await run(u, "select set_config('app.now', '2000-01-01', true), public.now_utc() t")).rows[0]!.t as Date;
    expect(t.getFullYear()).toBeGreaterThan(2020);
  });
});

describe("expire_subscriptions sweeper", () => {
  it("flips only expired live rows, audits and notifies, and is idempotent (time travel)", async () => {
    const u = await newUser();
    const keep = await newUser();
    await run(ids.admin, "select public.admin_grant_plan($1, 'pro', now() + interval '30 days', 'trial month')", [u]);
    await run(ids.admin, "select public.admin_grant_plan($1, 'plus', now() + interval '90 days', 'long one')", [keep]);
    try {
      await setClock(new Date(Date.now() + 31 * 86400000).toISOString());
      expect(await plan(u)).toBe("free"); // effective immediately, even before the sweeper runs
      expect((await raw("select status from public.subscriptions where user_id = $1", [u]))[0]!.status).toBe("active");
      const first = (await asService(db, (tx) => tx.query<any>("select public.expire_subscriptions() n"))).rows[0]!.n;
      expect(first).toBeGreaterThanOrEqual(1);
      expect((await raw("select status from public.subscriptions where user_id = $1", [u]))[0]!.status).toBe("expired");
      expect((await raw("select status from public.subscriptions where user_id = $1", [keep]))[0]!.status).toBe("active"); // positive control
      expect(await plan(keep)).toBe("plus");
      const subId = (await raw("select id from public.subscriptions where user_id = $1", [u]))[0]!.id;
      const audit = await raw("select actor_id, metadata from public.audit_logs where action = 'subscription.expired' and entity_id = $1", [subId]);
      expect(audit.length).toBe(1);
      expect(audit[0]).toMatchObject({ actor_id: null });
      expect(audit[0]!.metadata).toMatchObject({ user_id: u, plan: "pro", source: "manual" });
      expect((await raw("select params from public.notifications where user_id = $1 and template_key = 'plan_expired'", [u]))[0]!.params).toEqual({ plan: "PRO" });
      // second run: nothing left for u, no duplicate audit or notification
      await asService(db, (tx) => tx.query("select public.expire_subscriptions()"));
      expect((await raw("select count(*)::int c from public.audit_logs where action = 'subscription.expired' and entity_id = $1", [subId]))[0]!.c).toBe(1);
      expect((await raw("select count(*)::int c from public.notifications where user_id = $1 and template_key = 'plan_expired'", [u]))[0]!.c).toBe(1);
      // user may re-grant later (live-subscription uniqueness no longer blocks: the row is 'expired')
      await clearClock();
      await run(ids.admin, "select public.admin_grant_plan($1, 'plus', now() + interval '10 days', 'again')", [u]);
      expect(await plan(u)).toBe("plus");
    } finally {
      await clearClock();
    }
  });

  it("is service-role only", async () => {
    const u = await newUser();
    await expect(run(u, "select public.expire_subscriptions()")).rejects.toThrow(/permission denied/);
    await expect(run(ids.admin, "select public.expire_subscriptions()")).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, (tx) => tx.query("select public.expire_subscriptions()"))).rejects.toThrow(/permission denied/);
  });

  it("pg_cron schedule is guarded by an extension check (documented fallback otherwise)", () => {
    const files = migrationFiles().filter((f) => f.includes("subscription_expiry"));
    const sql = readFileSync(path.resolve(__dirname, "../../../supabase/migrations", files[0]!), "utf8");
    expect(sql).toMatch(/exists \(select 1 from pg_extension where extname = 'pg_cron'\)/);
    expect(sql).toMatch(/cron\.schedule\('expire-subscriptions'/);
  });
});

describe("users cannot alter subscriptions or their plan", () => {
  it("insert / update / delete are all denied; owner may only read (positive controls: service writes, owner reads)", async () => {
    const u = await newUser();
    await sub(u, "plus", "active", "2999-01-01");
    expect(await affected(db, "authenticated", u, "insert into public.subscriptions (user_id, plan, status) values ($1, 'pro', 'active')", [u])).toBe(0);
    expect(await affected(db, "authenticated", u, "update public.subscriptions set plan = 'pro' where user_id = $1", [u])).toBe(0);
    expect(await affected(db, "authenticated", u, "update public.subscriptions set current_period_end = '2999-12-31' where user_id = $1", [u])).toBe(0);
    expect(await affected(db, "authenticated", u, "update public.subscriptions set status = 'active' where user_id = $1", [u])).toBe(0);
    expect(await affected(db, "authenticated", u, "delete from public.subscriptions where user_id = $1", [u])).toBe(0);
    expect(await affected(db, "anon", null, "update public.subscriptions set plan = 'pro'")).toBe(0);
    expect(await plan(u)).toBe("plus");
    expect((await select(db, "authenticated", u, "select plan from public.subscriptions")).map((r) => r.plan)).toEqual(["plus"]);
    expect(await affected(db, "service_role", null, "update public.subscriptions set cancel_at_period_end = true where user_id = $1", [u])).toBe(1);
  });
  it("profiles has no plan column and role escalation is still blocked", async () => {
    const u = await newUser();
    await expect(run(u, "update public.profiles set plan = 'pro' where id = $1", [u])).rejects.toThrow(/column "plan"/);
    await expect(run(u, "update public.profiles set role = 'admin' where id = $1", [u])).rejects.toThrow(/only admins|super_admin/);
  });
});
