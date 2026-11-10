import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, ids, seedFixtures } from "./harness";

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
  await seedFixtures(db);
}, 120_000);
afterAll(async () => {
  await db.close();
});

const { alice: A, bob: B, mod: MOD, admin: ADMIN, superAdmin: SUPER } = ids;
const run = (uid: string, sql: string, params: unknown[] = []) => asUser(db, uid, (tx) => tx.query<Record<string, any>>(sql, params));
const raw = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows;
const audit = async (action: string) => raw("select * from public.audit_logs where action = $1 order by id", [action]);
const REASON = "support ticket 1234";

type Who = "student" | "moderator" | "admin";
const actor: Record<Who, string> = { student: A, moderator: MOD, admin: ADMIN };

describe("role gates: admin-only functions reject students and moderators", () => {
  const gated: [string, string, unknown[]][] = [
    ["admin_list_users", "select * from public.admin_list_users(null, 5, 0)", []],
    ["admin_user_subscriptions", "select * from public.admin_user_subscriptions($1)", [A]],
    ["admin_expiring_subscriptions", "select * from public.admin_expiring_subscriptions(14, 5, 0)", []],
    ["admin_run_subscription_expiry", "select public.admin_run_subscription_expiry()", []],
    ["admin_set_user_suspended", "select public.admin_set_user_suspended($1, true, $2)", [B, REASON]],
    ["admin_upsert_university", "select public.admin_upsert_university(null, 'X Uni', null, null, 'university', 'state', null, $1)", [REASON]],
    ["admin_verify_university", "select public.admin_verify_university($1, $2)", [ids.pubCommunity, REASON]],
    ["admin_upsert_faculty", "select public.admin_upsert_faculty(null, $1, 'F', $2)", [ids.pubCommunity, REASON]],
    ["admin_delete_academic", "select public.admin_delete_academic('course', $1, $2)", [ids.pubCommunity, REASON]],
    ["admin_create_prompt_version", "select public.admin_create_prompt_version('p', 't', null, false, $1)", [REASON]],
  ];
  for (const [name, sql, params] of gated) {
    for (const who of ["student", "moderator"] as const) {
      it(`${name}: ${who} rejected`, async () => {
        await expect(run(actor[who], sql, params)).rejects.toThrow(/admin privileges required/);
      });
    }
  }
  it("moderation lists: students rejected, moderators allowed", async () => {
    for (const sql of ["select * from public.admin_reports_queue('open', 5, 0)", "select * from public.admin_removed_content('resource', 5, 0)",
      "select * from public.admin_communities_overview(null, 5, 0)", "select public.admin_overview_counters()"]) {
      await expect(run(A, sql)).rejects.toThrow(/moderator privileges required/);
      await run(MOD, sql);
    }
  });
  it("anon cannot execute", async () => {
    await expect(db.query("set role anon; select public.admin_overview_counters()")).rejects.toThrow();
    await db.query("reset role");
  });
});

describe("overview counters", () => {
  it("moderators see only moderation counters; admins also see platform counters", async () => {
    const m = (await run(MOD, "select public.admin_overview_counters() as c")).rows[0]!.c;
    expect(Object.keys(m).sort()).toEqual(["open_reports", "open_takedowns", "pending_events", "pending_resources"]);
    const a = (await run(ADMIN, "select public.admin_overview_counters() as c")).rows[0]!.c;
    expect(a.users_total).toBeGreaterThanOrEqual(6);
    expect(a.unverified_institutions).toBe(24);
  });
});

describe("users list: no e-mail, no private content, search is literal", () => {
  it("returns minimal columns and effective plan", async () => {
    await db.query("insert into public.subscriptions (user_id, plan) values ($1, 'plus')", [B]);
    const r = await run(ADMIN, "select * from public.admin_list_users(null, 50, 0)");
    expect(Object.keys(r.rows[0]!).sort()).toEqual(["created_at", "display_name", "id", "plan", "role", "suspended", "total", "university_name", "username"]);
    expect(r.rows.find((x) => x.id === B)!.plan).toBe("plus");
    expect(r.rows.find((x) => x.id === A)!.plan).toBe("free");
  });
  it("searches by name/uuid and escapes wildcards", async () => {
    expect((await run(ADMIN, "select * from public.admin_list_users('ali', 10, 0)")).rows.map((x) => x.id)).toEqual([A]);
    expect((await run(ADMIN, "select * from public.admin_list_users($1, 10, 0)", [B])).rows.map((x) => x.id)).toEqual([B]);
    expect((await run(ADMIN, "select * from public.admin_list_users('%', 10, 0)")).rows).toHaveLength(0);
    await expect(run(ADMIN, "select * from public.admin_list_users($1, 10, 0)", ["x".repeat(101)])).rejects.toThrow(/too long/);
  });
});

describe("suspend / restore", () => {
  it("requires a reason, refuses self and staff, audits only real changes", async () => {
    await expect(run(ADMIN, "select public.admin_set_user_suspended($1, true, 'x')", [A])).rejects.toThrow(/reason/);
    await expect(run(ADMIN, "select public.admin_set_user_suspended($1, true, $2)", [ADMIN, REASON])).rejects.toThrow(/yourself/);
    await expect(run(ADMIN, "select public.admin_set_user_suspended($1, true, $2)", [MOD, REASON])).rejects.toThrow(/staff/);
    expect((await run(ADMIN, "select public.admin_set_user_suspended($1, true, $2) as r", [A, REASON])).rows[0]!.r).toBe(true);
    expect((await run(ADMIN, "select public.admin_set_user_suspended($1, true, $2) as r", [A, REASON])).rows[0]!.r).toBe(false);
    expect((await run(ADMIN, "select suspended from public.admin_list_users('alice', 5, 0)")).rows[0]!.suspended).toBe(true);
    expect(await audit("user.suspend")).toHaveLength(1);
    expect((await run(ADMIN, "select public.admin_set_user_suspended($1, false, $2) as r", [A, REASON])).rows[0]!.r).toBe(true);
    expect(await audit("user.restore")).toHaveLength(1);
  });
  it("a student cannot read or write account_suspensions directly", async () => {
    await run(ADMIN, "select public.admin_set_user_suspended($1, true, $2)", [B, REASON]);
    expect((await run(A, "select * from public.account_suspensions")).rows).toHaveLength(0);
    await expect(run(B, "delete from public.account_suspensions where user_id = $1", [B])).rejects.toThrow();
    await run(ADMIN, "select public.admin_set_user_suspended($1, false, $2)", [B, REASON]);
  });
});

describe("subscriptions", () => {
  it("lists expiring/overdue subscriptions and the manual sweeper expires them (audited, idempotent)", async () => {
    await db.query("delete from public.subscriptions where user_id = $1", [A]);
    await db.query("insert into public.subscriptions (user_id, plan, status, current_period_start, current_period_end) values ($1, 'pro', 'active', now() - interval '3 days', now() - interval '1 day')", [A]);
    const l = await run(ADMIN, "select * from public.admin_expiring_subscriptions(14, 10, 0)");
    expect(l.rows.find((x) => x.user_id === A)!.overdue).toBe(true);
    expect((await run(ADMIN, "select public.admin_run_subscription_expiry() as n")).rows[0]!.n).toBeGreaterThanOrEqual(1);
    expect((await run(ADMIN, "select public.admin_run_subscription_expiry() as n")).rows[0]!.n).toBe(0);
    expect((await audit("subscription.sweep.manual")).length).toBe(2);
    expect((await run(ADMIN, "select * from public.admin_user_subscriptions($1)", [A])).rows[0]!.status).toBe("expired");
  });
});

describe("moderation lists", () => {
  it("reports queue shows excerpts but no reporter or author identity", async () => {
    await db.query("insert into public.reports (reporter_id, post_id, reason) values ($1, $2, 'spam spam')", [B, ids.pubPost]);
    const r = await run(MOD, "select * from public.admin_reports_queue('open', 10, 0)");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.target_kind).toBe("post");
    expect(r.rows[0]!.excerpt).toContain("public post");
    expect(Object.keys(r.rows[0]!)).not.toEqual(expect.arrayContaining(["reporter_id"]));
    expect(Object.keys(r.rows[0]!)).not.toEqual(expect.arrayContaining(["author_id"]));
    await expect(run(MOD, "select * from public.admin_reports_queue('bogus', 10, 0)")).rejects.toThrow(/invalid status/);
  });
  it("removed content lists resources removed by moderators", async () => {
    const r = await raw("insert into public.resources (uploader_id, title, status) values ($1, 'Old notes', 'published') returning id", [A]);
    await run(MOD, "select public.admin_moderate_content('resource', $1, 'remove', $2)", [r[0]!.id, REASON]);
    const rows = (await run(MOD, "select * from public.admin_removed_content('resource', 10, 0)")).rows;
    expect(rows.map((x) => x.id)).toContain(r[0]!.id);
    expect((await run(MOD, "select public.admin_moderate_content('resource', $1, 'restore', $2) as ok", [r[0]!.id, REASON])).rows[0]!.ok).toBe(true);
  });
  it("communities overview counts members and open reports", async () => {
    const r = await run(MOD, "select * from public.admin_communities_overview('public', 10, 0)");
    const c = r.rows.find((x) => x.id === ids.pubCommunity)!;
    expect(Number(c.members)).toBeGreaterThanOrEqual(2);
    expect(Number(c.open_reports)).toBe(1);
  });
});

describe("academic data", () => {
  it("verifies a user-supplied institution once, with audit", async () => {
    const id = (await raw("select id from public.universities where source = 'user_supplied_unverified' limit 1"))[0]!.id;
    await expect(run(ADMIN, "select public.admin_verify_university($1, 'x')", [id])).rejects.toThrow(/reason/);
    expect((await run(ADMIN, "select public.admin_verify_university($1, $2) as r", [id, REASON])).rows[0]!.r).toBe(true);
    expect((await run(ADMIN, "select public.admin_verify_university($1, $2) as r", [id, REASON])).rows[0]!.r).toBe(false);
    expect((await raw("select source from public.universities where id = $1", [id]))[0]!.source).toBe("admin_verified");
    expect(await audit("academic.university.verify")).toHaveLength(1);
  });
  it("creates, edits and deletes the hierarchy; refuses deleting parents in use", async () => {
    const u = (await run(ADMIN, "select public.admin_upsert_university(null, 'Test Uni', 'TU', 'Baku', 'college', 'private', null, $1) as id", [REASON])).rows[0]!.id;
    expect((await raw("select source, institution_type, ownership from public.universities where id = $1", [u]))[0]).toEqual({ source: "admin_verified", institution_type: "college", ownership: "private" });
    await run(ADMIN, "select public.admin_upsert_university($1, 'Test Uni 2', null, null, 'university', 'state', null, $2)", [u, REASON]);
    const f = (await run(ADMIN, "select public.admin_upsert_faculty(null, $1, 'Faculty A', $2) as id", [u, REASON])).rows[0]!.id;
    const m = (await run(ADMIN, "select public.admin_upsert_major(null, $1, 'Major A', 'master', $2) as id", [f, REASON])).rows[0]!.id;
    const c = (await run(ADMIN, "select public.admin_upsert_course(null, $1, $2, 'CS101', 'Intro', 6, $3) as id", [u, m, REASON])).rows[0]!.id;
    await expect(run(ADMIN, "select public.admin_delete_academic('university', $1, $2)", [u, REASON])).rejects.toThrow(/in use/);
    await expect(run(ADMIN, "select public.admin_delete_academic('faculty', $1, $2)", [f, REASON])).rejects.toThrow(/majors/);
    await expect(run(ADMIN, "select public.admin_delete_academic('major', $1, $2)", [m, REASON])).rejects.toThrow(/in use/);
    for (const [k, id] of [["course", c], ["major", m], ["faculty", f], ["university", u]] as const) {
      expect((await run(ADMIN, "select public.admin_delete_academic($1, $2, $3) as r", [k, id, REASON])).rows[0]!.r).toBe(true);
    }
    expect((await run(ADMIN, "select public.admin_delete_academic('course', $1, $2) as r", [c, REASON])).rows[0]!.r).toBe(false);
    expect((await audit("academic.course.delete")).length).toBe(1);
    await expect(run(ADMIN, "select public.admin_upsert_university(null, 'Bad', null, null, 'zoo', 'state', null, $1)", [REASON])).rejects.toThrow(/invalid type/);
  });
  it("a student cannot delete via RLS-backed direct writes either (policies unchanged)", async () => {
    await expect(run(A, "delete from public.universities where name = 'Bakı Dövlət Universiteti'")).resolves.toBeDefined();
    expect((await raw("select 1 from public.universities where name = 'Bakı Dövlət Universiteti'")).length).toBe(1);
  });
});

describe("prompt versions", () => {
  it("creates numbered versions and keeps exactly one active per name", async () => {
    const p1 = (await run(ADMIN, "select public.admin_create_prompt_version('summary', 'T1', 'm', true, $1) as id", [REASON])).rows[0]!.id;
    const p2 = (await run(SUPER, "select public.admin_create_prompt_version('summary', 'T2', null, true, $1) as id", [REASON])).rows[0]!.id;
    const p3 = (await run(ADMIN, "select public.admin_create_prompt_version('summary', 'T3', null, false, $1) as id", [REASON])).rows[0]!.id;
    let rows = await raw("select id, version, is_active from public.prompt_versions where name = 'summary' order by version");
    expect(rows.map((r) => [r.version, r.is_active])).toEqual([[1, false], [2, true], [3, false]]);
    await run(ADMIN, "select public.admin_activate_prompt_version($1, $2)", [p1, REASON]);
    rows = await raw("select id, is_active from public.prompt_versions where name = 'summary'");
    expect(rows.filter((r) => r.is_active).map((r) => r.id)).toEqual([p1]);
    expect(p2).not.toBe(p3);
    expect(await audit("prompt.create")).toHaveLength(3);
  });
  it("validates name, template and reason", async () => {
    await expect(run(ADMIN, "select public.admin_create_prompt_version('bad name!', 't', null, false, $1)", [REASON])).rejects.toThrow(/name/);
    await expect(run(ADMIN, "select public.admin_create_prompt_version('ok', '  ', null, false, $1)", [REASON])).rejects.toThrow(/template/);
    await expect(run(ADMIN, "select public.admin_create_prompt_version('ok', 't', null, false, '')")).rejects.toThrow(/reason/);
  });
});
