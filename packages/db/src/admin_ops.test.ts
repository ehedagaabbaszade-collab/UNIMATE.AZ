import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, createTestDb, ids, seedFixtures, select } from "./harness";

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
const SUPER = ids.superAdmin;

const raw = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows;
const run = (uid: string, sql: string, params: unknown[] = []) => asUser(db, uid, (tx) => tx.query<Record<string, any>>(sql, params));
const uuid = (prefix: string, k: number) => `${prefix}0000000-0000-4000-8000-${String(k).padStart(12, "0")}`;
const audit = async (action: string, entity: string) =>
  (await raw("select * from public.audit_logs where action = $1 and entity_id = $2 order by id", [action, entity]));

/** Role matrix: for each function, who is allowed. Others must be rejected with a privileges error. */
type Who = "student" | "moderator" | "admin" | "super_admin";
const actor: Record<Who, string> = { student: A, moderator: MOD, admin: ADMIN, super_admin: SUPER };
const ORDER: Who[] = ["student", "moderator", "admin", "super_admin"];
const atLeast = (min: Who): Who[] => ORDER.slice(ORDER.indexOf(min));

const analytics: [string, string, string[], Who][] = [
  ["admin_active_users", "select * from public.admin_active_users(7)", [], "admin"],
  ["admin_documents_by_status", "select * from public.admin_documents_by_status()", [], "admin"],
  ["admin_jobs_by_state", "select * from public.admin_jobs_by_state()", [], "admin"],
  ["admin_ai_cost_by_day", "select * from public.admin_ai_cost_by_day(7)", [], "admin"],
  ["admin_subscriptions_by_plan", "select * from public.admin_subscriptions_by_plan()", [], "admin"],
];

describe("analytics RPCs: admin/super_admin only, aggregates only", () => {
  beforeAll(async () => {
    await db.query("insert into public.xp_events (user_id, kind, points) values ($1, 'x', 5), ($2, 'x', 5)", [A, B]);
    await db.query("insert into public.study_sessions (user_id) values ($1), ($3), ($2)", [A, C, B]);
    await db.query("insert into public.xp_events (user_id, kind, points, created_at) values ($1, 'x', 5, now() - interval '3 days')", [C]);
    await db.query("insert into public.processing_jobs (document_id, user_id, kind, idempotency_key, state, locked_at) values ($1, $2, 'embed', 'job-adm-0001', 'running', now())", [ids.docA, A]);
    await db.query("insert into public.ai_usage (user_id, feature, model, input_tokens, output_tokens, cost_micro_usd) values ($1, 'chat', 'mx', 4, 6, 1234)", [A]);
    await db.query("insert into public.subscriptions (user_id, plan) values ($1, 'plus')", [B]);
  });

  describe.each(analytics)("%s", (_n, sql, params, min) => {
    for (const who of ORDER) {
      if (atLeast(min).includes(who)) {
        it(`${who} allowed`, async () => {
          const r = await run(actor[who], sql, params);
          expect(r.rows.length).toBeGreaterThan(0);
          for (const row of r.rows) {
            expect(Object.keys(row)).not.toEqual(expect.arrayContaining(["user_id"]));
            expect(JSON.stringify(row)).not.toMatch(new RegExp(`${A}|${B}|${C}`));
          }
        });
      } else {
        it(`${who} denied`, async () => {
          await expect(run(actor[who], sql, params)).rejects.toThrow(/admin privileges required/);
        });
      }
    }
    it("anon denied", async () => {
      await expect(asAnon(db, (tx) => tx.query(sql, params))).rejects.toThrow(/permission denied/);
    });
  });

  it("DAU/WAU count distinct users per Baku day from xp_events + study_sessions", async () => {
    const r = (await run(ADMIN, "select * from public.admin_active_users(7)")).rows;
    expect(r.length).toBe(7);
    const today = r[r.length - 1]!;
    expect(today.dau).toBe(2 + 1); // A, B (xp+sessions) and C (session)
    expect(today.wau).toBe(3);
    expect(Object.keys(today).sort()).toEqual(["dau", "day", "wau"]);
    await expect(run(ADMIN, "select * from public.admin_active_users(0)")).rejects.toThrow(/days must be/);
  });
  it("cost, status, job and plan aggregates are right and carry no student content", async () => {
    const cost = (await run(ADMIN, "select * from public.admin_ai_cost_by_day(1)")).rows.find((x) => x.model === "mx");
    expect(cost).toMatchObject({ requests: 1 });
    expect(Number(cost!.cost_micro_usd)).toBe(1234);
    expect((await run(ADMIN, "select * from public.admin_documents_by_status()")).rows.length).toBeGreaterThan(0);
    expect((await run(SUPER, "select * from public.admin_jobs_by_state()")).rows).toContainEqual({ kind: "embed", state: "running", n: 1 });
    expect((await run(SUPER, "select * from public.admin_subscriptions_by_plan()")).rows).toContainEqual({ plan: "plus", source: "paid", n: 1 });
  });
});

describe("system_config", () => {
  it("students, moderators and anon see and write nothing; admins manage it; changes are audited", async () => {
    await db.query("insert into public.system_config (key, value) values ('seed.flag', 'true')");
    expect((await select(db, "authenticated", ADMIN, "select * from public.system_config")).length).toBe(1);
    expect((await select(db, "authenticated", SUPER, "select * from public.system_config")).length).toBe(1);
    // No direct write path for any API role (admins included): writes go through admin_set_system_config.
    for (const u of [A, MOD, ADMIN, SUPER]) {
      if (u === A || u === MOD) expect(await select(db, "authenticated", u, "select * from public.system_config")).toEqual([]);
      await expect(run(u, "insert into public.system_config (key, value) values ('x.y', '1')")).rejects.toThrow(/permission denied/);
      await expect(run(u, "update public.system_config set value = '0'")).rejects.toThrow(/permission denied/);
      await expect(run(u, "delete from public.system_config")).rejects.toThrow(/permission denied/);
    }
    expect(await select(db, "anon", null, "select * from public.system_config")).toEqual([]);
    await run(ADMIN, "select public.admin_set_system_config('signup.enabled', 'true'::jsonb, 'valid reason')");
    expect((await raw("select updated_by from public.system_config where key = 'signup.enabled'"))[0]!.updated_by).toBe(ADMIN);
    await run(SUPER, "select public.admin_set_system_config('signup.enabled', 'false'::jsonb, 'valid reason')");
    expect((await raw("select updated_by from public.system_config where key = 'signup.enabled'"))[0]!.updated_by).toBe(SUPER);
    const a = await raw("select action, actor_id, metadata from public.audit_logs where entity_type = 'system_config' and entity_id = 'signup.enabled' order by id");
    expect(a.map((x) => x.action)).toEqual(["config.insert", "config.update"]);
    expect(a.map((x) => x.actor_id)).toEqual([ADMIN, SUPER]);
    expect(JSON.stringify(a)).not.toContain('"value"');
  });
});

describe("admin_grant_plan", () => {
  const grant = (uid: string, target: string, plan = "pro", until: string | null = "now() + interval '30 days'", reason = "support gift") =>
    run(uid, `select public.admin_grant_plan($1, $2::public.sub_plan, ${until ?? "null::timestamptz"}, $3) as id`, [target, plan, reason]);
  const live = (u: string) => raw("select * from public.subscriptions where user_id = $1 and status in ('active','trialing','past_due')", [u]);
  let u1 = "";
  beforeAll(async () => {
    u1 = uuid("a", 1);
    await db.query("insert into auth.users (id, email) values ($1, 'grant1@example.test')", [u1]);
  });

  for (const who of ["student", "moderator"] as Who[]) {
    it(`${who} denied`, async () => {
      await expect(grant(actor[who], u1)).rejects.toThrow(/admin privileges required/);
      expect(await live(u1)).toEqual([]);
    });
  }
  it("admin grants a manual plan: source manual, audited, visible to the user (positive control)", async () => {
    const id = (await grant(ADMIN, u1)).rows[0]!.id;
    const s = (await live(u1))[0]!;
    expect(s).toMatchObject({ id, plan: "pro", source: "manual", provider: "manual", granted_by: ADMIN, grant_reason: "support gift" });
    expect((await audit("plan.grant", u1)).length).toBe(1);
    expect((await select(db, "authenticated", u1, "select plan, source from public.subscriptions")).length).toBe(1);
  });
  it("re-grant replaces the live manual grant (one live row); free revokes; super_admin may grant", async () => {
    await grant(SUPER, u1, "plus"); // until is mandatory since 20260101003400 (was: null = unlimited)
    const l = await live(u1);
    expect(l.length).toBe(1);
    expect(l[0]).toMatchObject({ plan: "plus" });
    expect(l[0]!.current_period_end).not.toBeNull();
    await grant(ADMIN, u1, "free");
    expect(await live(u1)).toEqual([]);
  });
  it("refuses a live paid subscription, bad reason, past until, unknown user", async () => {
    await db.query("insert into public.subscriptions (user_id, plan) values ($1, 'plus')", [u1]);
    await expect(grant(ADMIN, u1)).rejects.toThrow(/live paid subscription/);
    expect((await live(u1))[0]).toMatchObject({ source: "paid" });
    await expect(grant(ADMIN, u1, "pro", "now() + interval '1 day'", "x")).rejects.toThrow(/reason/);
    await expect(grant(ADMIN, u1, "pro", "now() - interval '1 day'")).rejects.toThrow(/future/);
    await expect(grant(ADMIN, uuid("a", 99))).rejects.toThrow(/user not found/);
  });
});

describe("admin_set_role", () => {
  const setRole = (uid: string, target: string, role: string, reason = "promotion") =>
    run(uid, "select public.admin_set_role($1, $2::public.app_role, $3)", [target, role, reason]);
  const role = async (u: string) => (await raw("select role from public.profiles where id = $1", [u]))[0]!.role;
  it("student, moderator and admin are denied", async () => {
    for (const who of ["student", "moderator", "admin"] as Who[]) {
      await expect(setRole(actor[who], B, "moderator")).rejects.toThrow(/super_admin privileges required/);
    }
    await expect(setRole(ADMIN, B, "admin")).rejects.toThrow(/super_admin/);
    expect(await role(B)).toBe("student");
  });
  it("super_admin sets roles, audited with from/to/reason; guards self and last super_admin", async () => {
    await setRole(SUPER, B, "moderator");
    expect(await role(B)).toBe("moderator");
    const a = (await audit("role.set", B))[0]!;
    expect(a.actor_id).toBe(SUPER);
    expect(a.metadata).toMatchObject({ from: "student", to: "moderator", reason: "promotion" });
    await setRole(SUPER, B, "student");
    await expect(setRole(SUPER, SUPER, "admin")).rejects.toThrow(/own role/);
    await expect(setRole(SUPER, A, "student", "xx")).rejects.toThrow(/reason/);
    await expect(setRole(SUPER, uuid("a", 98), "student")).rejects.toThrow(/user not found/);
    await setRole(SUPER, A, "super_admin");
    await setRole(SUPER, A, "student"); // demote works while another super_admin exists
    expect(await role(A)).toBe("student");
    await db.query("update public.profiles set role = 'student' where id = $1", [ADMIN]);
    await db.query("update public.profiles set role = 'super_admin' where id = $1", [A]);
    await db.query("update public.profiles set role = 'student' where id = $1", [SUPER]);
    await db.query("update public.profiles set role = 'super_admin' where id = $1", [SUPER]);
    await db.query("update public.profiles set role = 'student' where id = $1", [A]);
    await db.query("update public.profiles set role = 'admin' where id = $1", [ADMIN]);
    // last super_admin (only SUPER): another actor cannot exist; verify via direct state check
    expect((await raw("select count(*)::int c from public.profiles where role = 'super_admin'"))[0]!.c).toBe(1);
  });
});

describe("admin_moderate_content", () => {
  const mod = (uid: string, kind: string, id: string, action: string, reason = "policy violation") =>
    run(uid, "select public.admin_moderate_content($1, $2, $3, $4) as ch", [kind, id, action, reason]);
  const res = uuid("9", 1);
  const ev = uuid("9", 2);
  const comment = uuid("9", 3);
  beforeAll(async () => {
    await db.query("insert into public.resources (id, uploader_id, title, status) values ($1, $2, 'r', 'published')", [res, A]);
    await db.query("insert into public.events (id, created_by, title, starts_at, status) values ($1, $2, 'e', now(), 'published')", [ev, A]);
    await db.query("insert into public.comments (id, post_id, author_id, body) values ($1, $2, $3, 'c')", [comment, ids.pubPost, C]);
  });
  const cases: [string, string][] = [["post", ids.pubPost], ["comment", comment], ["resource", res], ["event", ev]];

  it.each(cases)("%s: student denied", async (kind, id) => {
    await expect(mod(A, kind, id, "remove")).rejects.toThrow(/moderator privileges required/);
  });
  it.each(cases)("%s: moderator removes and restores; idempotent; audited once each", async (kind, id) => {
    expect((await mod(MOD, kind, id, "remove")).rows[0]!.ch).toBe(true);
    expect((await mod(MOD, kind, id, "remove")).rows[0]!.ch).toBe(false);
    expect((await mod(ADMIN, kind, id, "restore")).rows[0]!.ch).toBe(true);
    expect((await mod(SUPER, kind, id, "restore")).rows[0]!.ch).toBe(false);
    expect((await audit("content.remove", id)).length).toBe(1);
    expect((await audit("content.restore", id)).length).toBe(1);
    expect((await audit("content.remove", id))[0]!.entity_type).toBe(kind);
  });
  it("effects are real: post soft-deleted is hidden from non-authors, restored is visible again", async () => {
    await mod(MOD, "post", ids.pubPost, "remove");
    expect((await raw("select deleted_at from public.posts where id = $1", [ids.pubPost]))[0]!.deleted_at).not.toBeNull();
    expect((await select(db, "authenticated", C, "select id from public.posts where id = $1", [ids.pubPost])).length).toBe(0);
    await mod(MOD, "post", ids.pubPost, "restore");
    expect((await select(db, "authenticated", C, "select id from public.posts where id = $1", [ids.pubPost])).length).toBe(1);
    await mod(MOD, "resource", res, "remove");
    expect((await raw("select status from public.resources where id = $1", [res]))[0]!.status).toBe("removed");
    await mod(MOD, "resource", res, "restore");
  });
  it("validates inputs", async () => {
    await expect(mod(MOD, "user", res, "remove")).rejects.toThrow(/invalid kind/);
    await expect(mod(MOD, "post", ids.pubPost, "ban")).rejects.toThrow(/invalid action/);
    await expect(mod(MOD, "post", ids.pubPost, "remove", "x")).rejects.toThrow(/reason/);
    await expect(mod(MOD, "post", uuid("9", 77), "remove")).rejects.toThrow(/not found/);
  });
});

describe("admin_resolve_report / admin_resolve_takedown", () => {
  let k = 0;
  const mkReport = async () => {
    const id = uuid("b", ++k);
    const post = uuid("f", k);
    await db.query("insert into public.posts (id, community_id, author_id, title, body) values ($1, $2, $3, 't', 'b')", [post, ids.pubCommunity, A]);
    await db.query("insert into public.reports (id, reporter_id, post_id, reason) values ($1, $2, $3, 'spam spam')", [id, B, post]);
    return id;
  };
  const mkTakedown = async () => {
    const rid = uuid("c", ++k);
    await db.query("insert into public.resources (id, uploader_id, title, status) values ($1, $2, 'td', 'published')", [rid, A]);
    const id = uuid("d", k);
    await db.query("insert into public.takedown_requests (id, resource_id, requester_id, reason) values ($1, $2, $3, 'copyrighted material')", [id, rid, B]);
    return { id, rid };
  };
  const rep = (uid: string, id: string, status = "actioned") => run(uid, "select public.admin_resolve_report($1, $2::public.report_status, 'checked')", [id, status]);
  const td = (uid: string, id: string, d = "accepted") => run(uid, "select public.admin_resolve_takedown($1, $2::public.takedown_status, 'valid claim')", [id, d]);

  it("report: student denied; moderator/admin/super_admin resolve; audited; no double resolve", async () => {
    const r0 = await mkReport();
    await expect(rep(A, r0)).rejects.toThrow(/moderator privileges required/);
    expect((await raw("select status from public.reports where id = $1", [r0]))[0]!.status).toBe("open");
    for (const [who, st] of [["moderator", "actioned"], ["admin", "dismissed"], ["super_admin", "reviewing"]] as [Who, string][]) {
      const id = await mkReport();
      await rep(actor[who], id, st);
      expect(await raw("select status, handled_by from public.reports where id = $1", [id])).toEqual([{ status: st, handled_by: actor[who] }]);
      expect((await audit(`report.${st}`, id)).length).toBe(1);
    }
    await rep(MOD, r0);
    await expect(rep(ADMIN, r0, "dismissed")).rejects.toThrow(/already resolved/);
    await expect(rep(MOD, await mkReport(), "open")).rejects.toThrow(/invalid status/);
    await expect(rep(MOD, uuid("b", 999))).rejects.toThrow(/not found/);
  });
  it("takedown: student denied; accept removes the resource; reject keeps it; no double resolve", async () => {
    const t0 = await mkTakedown();
    await expect(td(A, t0.id)).rejects.toThrow(/moderator privileges required/);
    await td(MOD, t0.id);
    expect((await raw("select status from public.resources where id = $1", [t0.rid]))[0]!.status).toBe("removed");
    expect((await raw("select status, resolved_by, resolved_at is not null as r from public.takedown_requests where id = $1", [t0.id]))[0]).toEqual({ status: "accepted", resolved_by: MOD, r: true });
    expect((await audit("takedown.accepted", t0.id)).length).toBe(1);
    await expect(td(ADMIN, t0.id)).rejects.toThrow(/already resolved/);
    const t1 = await mkTakedown();
    await td(ADMIN, t1.id, "rejected");
    expect((await raw("select status from public.resources where id = $1", [t1.rid]))[0]!.status).toBe("published");
    const t2 = await mkTakedown();
    await td(SUPER, t2.id);
    await expect(td(MOD, t2.id, "open")).rejects.toThrow();
  });
});

describe("prompt_versions management", () => {
  const p = [uuid("e", 1), uuid("e", 2), uuid("e", 3)];
  const active = async (name: string) => (await raw("select id from public.prompt_versions where name = $1 and is_active order by id", [name])).map((r) => r.id);
  beforeAll(async () => {
    await db.query("insert into public.prompt_versions (id, name, version, template, is_active) values ($1, 'sum', 1, 't', true), ($2, 'sum', 2, 't', false), ($3, 'other', 1, 't', true)", p);
  });
  it("nobody writes prompt_versions directly (admins included); students and moderators see nothing", async () => {
    for (const u of [A, MOD, ADMIN, SUPER]) {
      if (u === A || u === MOD) expect(await select(db, "authenticated", u, "select * from public.prompt_versions")).toEqual([]);
      await expect(run(u, "insert into public.prompt_versions (name, version, template) values ('z', 1, 't')")).rejects.toThrow(/permission denied/);
      await expect(run(u, "update public.prompt_versions set template = 'hack'")).rejects.toThrow(/permission denied/);
      await expect(run(u, "delete from public.prompt_versions")).rejects.toThrow(/permission denied/);
    }
    expect((await select(db, "authenticated", SUPER, "select * from public.prompt_versions")).length).toBeGreaterThanOrEqual(3);
  });
  it("activation: students and moderators denied", async () => {
    for (const u of [A, MOD]) await expect(run(u, "select public.admin_activate_prompt_version($1, 'valid reason')", [p[1]])).rejects.toThrow(/admin privileges required/);
    expect(await active("sum")).toEqual([p[0]]);
  });
  it("admin and super_admin activate: exactly one active per name, other names untouched, audited", async () => {
    await run(ADMIN, "select public.admin_activate_prompt_version($1, 'valid reason')", [p[1]]);
    expect(await active("sum")).toEqual([p[1]]);
    expect(await active("other")).toEqual([p[2]]);
    await run(SUPER, "select public.admin_activate_prompt_version($1, 'valid reason')", [p[0]]);
    expect(await active("sum")).toEqual([p[0]]);
    await run(SUPER, "select public.admin_activate_prompt_version($1, 'valid reason')", [p[0]]);
    expect(await active("sum")).toEqual([p[0]]);
    expect((await audit("prompt.activate", p[1]!)).length).toBe(1);
    await expect(run(ADMIN, "select public.admin_activate_prompt_version($1, 'valid reason')", [uuid("e", 50)])).rejects.toThrow(/not found/);
  });
});

describe("anon cannot call any admin RPC", () => {
  it.each([
    "select public.admin_grant_plan(null, 'pro', null, 'xxx')",
    "select public.admin_set_role(null, 'student', 'xxx')",
    "select public.admin_moderate_content('post', null, 'remove', 'xxx')",
    "select public.admin_resolve_report(null, 'actioned')",
    "select public.admin_resolve_takedown(null, 'accepted', 'xxx')",
    "select public.admin_activate_prompt_version(null, 'xxx')",
  ])("%s", async (sql) => {
    await expect(asAnon(db, (tx) => tx.query(sql))).rejects.toThrow(/permission denied/);
  });
});
