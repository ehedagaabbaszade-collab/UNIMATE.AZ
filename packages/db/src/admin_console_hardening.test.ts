import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, ids, seedFixtures } from "./harness";

// Regression tests for the admin console security review. Everything runs as authenticated users (JWT identity, RLS and
// grants apply); `raw` is the superuser connection and is only used for fixtures and read-back.
let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
  await seedFixtures(db);
}, 120_000);
afterAll(async () => {
  await db.close();
});

const { alice: A, bob: B, mod: MOD, admin: ADMIN } = ids;
type R = Record<string, any>;
const run = (uid: string, sql: string, params: unknown[] = []) => asUser(db, uid, (tx) => tx.query<R>(sql, params));
const raw = async (sql: string, params: unknown[] = []) => (await db.query<R>(sql, params)).rows;
const REASON = "ticket 4711 review";

describe("admin_delete_academic: courses with enrollments", () => {
  it("refuses (55000) while enrollments exist, deletes once they are gone", async () => {
    const u = (await run(ADMIN, "select public.admin_upsert_university(null, 'Hard Uni', null, null, 'university', 'state', null, $1) as id", [REASON])).rows[0]!.id;
    const f = (await run(ADMIN, "select public.admin_upsert_faculty(null, $1, 'Hard Faculty', $2) as id", [u, REASON])).rows[0]!.id;
    const m = (await run(ADMIN, "select public.admin_upsert_major(null, $1, 'Hard Major', 'bachelor', $2) as id", [f, REASON])).rows[0]!.id;
    const c = (await run(ADMIN, "select public.admin_upsert_course(null, $1, $2, 'HD101', 'Hardening', 5, $3) as id", [u, m, REASON])).rows[0]!.id;
    await raw("insert into public.enrollments (user_id, course_id, term) values ($1, $2, '2026-fall')", [A, c]);
    await expect(run(ADMIN, "select public.admin_delete_academic('course', $1, $2)", [c, REASON])).rejects.toMatchObject({ code: "55000" });
    expect(await raw("select 1 from public.courses where id = $1", [c])).toHaveLength(1);
    await raw("delete from public.enrollments where course_id = $1", [c]);
    expect((await run(ADMIN, "select public.admin_delete_academic('course', $1, $2) as r", [c, REASON])).rows[0]!.r).toBe(true);
  });

  it("academic updates audit the old row; creates carry old = null", async () => {
    const u = (await run(ADMIN, "select public.admin_upsert_university(null, 'Audit Uni', null, 'Baku', 'university', 'state', null, $1) as id", [REASON])).rows[0]!.id;
    await run(ADMIN, "select public.admin_upsert_university($1, 'Audit Uni 2', null, 'Ganja', 'university', 'state', null, $2)", [u, REASON]);
    const f = (await run(ADMIN, "select public.admin_upsert_faculty(null, $1, 'Fac 1', $2) as id", [u, REASON])).rows[0]!.id;
    await run(ADMIN, "select public.admin_upsert_faculty($1, $2, 'Fac 2', $3)", [f, u, REASON]);
    const m = (await run(ADMIN, "select public.admin_upsert_major(null, $1, 'Maj 1', 'bachelor', $2) as id", [f, REASON])).rows[0]!.id;
    await run(ADMIN, "select public.admin_upsert_major($1, $2, 'Maj 2', 'master', $3)", [m, f, REASON]);
    const c = (await run(ADMIN, "select public.admin_upsert_course(null, $1, $2, 'AU1', 'Course 1', 3, $3) as id", [u, m, REASON])).rows[0]!.id;
    await run(ADMIN, "select public.admin_upsert_course($1, $2, $3, 'AU1', 'Course 2', 4, $4)", [c, u, m, REASON]);
    const get = async (action: string, id: string) => (await raw("select metadata from public.audit_logs where action = $1 and entity_id = $2", [action, id]))[0]!.metadata;
    expect((await get("academic.university.update", u)).old).toMatchObject({ name: "Audit Uni", city: "Baku" });
    expect((await get("academic.faculty.update", f)).old).toMatchObject({ name: "Fac 1" });
    expect((await get("academic.major.update", m)).old).toMatchObject({ name: "Maj 1", degree_level: "bachelor" });
    expect((await get("academic.course.update", c)).old).toMatchObject({ title: "Course 1" });
    expect((await get("academic.university.create", u)).old).toBeNull();
  });
});

describe("moderation: who/when and restore limits", () => {
  const mod = (uid: string, kind: string, id: string, action: string) =>
    run(uid, "select public.admin_moderate_content($1, $2, $3, $4) as ch", [kind, id, action, REASON]);
  const newPost = async () => (await raw("insert into public.posts (community_id, author_id, title, body) values ($1, $2, 't', 'b') returning id", [ids.pubCommunity, A]))[0]!.id as string;
  const newResource = async (status = "published") =>
    (await raw("insert into public.resources (uploader_id, title, status) values ($1, 'res', $2) returning id", [A, status]))[0]!.id as string;

  it("a moderator removal is stamped, cannot be undone or forged by the author, and restores for the moderator", async () => {
    const id = await newPost();
    expect((await mod(MOD, "post", id, "remove")).rows[0]!.ch).toBe(true);
    const s = (await raw("select removed_by, moderated_at, deleted_at from public.posts where id = $1", [id]))[0]!;
    expect(s.removed_by).toBe(MOD);
    expect(s.moderated_at).not.toBeNull();
    // the author cannot undelete or rewrite the stamp through the API
    await run(A, "update public.posts set deleted_at = null, removed_by = null, moderated_at = null where id = $1", [id]).catch(() => undefined);
    const after = (await raw("select removed_by, moderated_at, deleted_at from public.posts where id = $1", [id]))[0]!;
    expect(after.deleted_at).not.toBeNull();
    expect(after.removed_by).toBe(MOD);
    expect((await mod(ADMIN, "post", id, "restore")).rows[0]!.ch).toBe(true);
    expect((await raw("select removed_by, moderated_at, deleted_at from public.posts where id = $1", [id]))[0]).toEqual({ removed_by: null, moderated_at: null, deleted_at: null });
  });

  it("content deleted by its author cannot be restored by moderation (comments too)", async () => {
    const id = await newPost();
    await run(A, "update public.posts set deleted_at = now() where id = $1", [id]);
    expect((await raw("select deleted_at, moderated_at from public.posts where id = $1", [id]))[0]!.moderated_at).toBeNull();
    await expect(mod(MOD, "post", id, "restore")).rejects.toMatchObject({ code: "55000" });
    expect((await raw("select deleted_at from public.posts where id = $1", [id]))[0]!.deleted_at).not.toBeNull();
    const c = (await raw("insert into public.comments (post_id, author_id, body) values ($1, $2, 'c') returning id", [ids.pubPost, A]))[0]!.id;
    await raw("update public.comments set deleted_at = now() where id = $1", [c]);
    await expect(mod(MOD, "comment", c, "restore")).rejects.toMatchObject({ code: "55000" });
    // positive control: a moderator removal of a comment restores
    const c2 = (await raw("insert into public.comments (post_id, author_id, body) values ($1, $2, 'c2') returning id", [ids.pubPost, A]))[0]!.id;
    await mod(MOD, "comment", c2, "remove");
    expect((await mod(MOD, "comment", c2, "restore")).rows[0]!.ch).toBe(true);
  });

  it("resources: remove -> restore cannot bypass a copyright hold or an accepted takedown", async () => {
    // reported resource: hidden with takedown_hold; the moderator removal clears the hold flag, the open takedown still blocks restore
    const held = await newResource();
    await raw("insert into public.takedown_requests (resource_id, requester_id, reason) values ($1, $2, 'copyrighted material')", [held, B]);
    expect((await raw("select status, takedown_hold from public.resources where id = $1", [held]))[0]).toEqual({ status: "pending", takedown_hold: true });
    await mod(MOD, "resource", held, "remove");
    await expect(mod(MOD, "resource", held, "restore")).rejects.toThrow(/copyright takedown/);
    expect((await raw("select status from public.resources where id = $1", [held]))[0]!.status).toBe("removed");
    // takedown accepted: still refused
    const td = (await raw("select id from public.takedown_requests where resource_id = $1", [held]))[0]!.id;
    await run(MOD, "select public.admin_resolve_takedown($1, 'accepted'::public.takedown_status, 'valid claim')", [td]);
    await expect(mod(MOD, "resource", held, "restore")).rejects.toThrow(/copyright takedown/);
    // moderator-removed resource that is not under any takedown restores (positive control); so does a rejected takedown
    const plain = await newResource();
    await mod(MOD, "resource", plain, "remove");
    expect((await mod(MOD, "resource", plain, "restore")).rows[0]!.ch).toBe(true);
    const rej = await newResource();
    await raw("insert into public.takedown_requests (resource_id, requester_id, reason) values ($1, $2, 'copyrighted material')", [rej, B]);
    await mod(MOD, "resource", rej, "remove");
    const td2 = (await raw("select id from public.takedown_requests where resource_id = $1", [rej]))[0]!.id;
    await run(MOD, "select public.admin_resolve_takedown($1, 'rejected'::public.takedown_status, 'no claim')", [td2]);
    expect((await mod(MOD, "resource", rej, "restore")).rows[0]!.ch).toBe(true);
    // a resource removed by a takedown (no moderation stamp) is not restorable here either
    const viaTd = await newResource();
    await raw("insert into public.takedown_requests (resource_id, requester_id, reason) values ($1, $2, 'copyrighted material')", [viaTd, B]);
    const td3 = (await raw("select id from public.takedown_requests where resource_id = $1", [viaTd]))[0]!.id;
    await run(MOD, "select public.admin_resolve_takedown($1, 'accepted'::public.takedown_status, 'valid claim')", [td3]);
    await expect(mod(MOD, "resource", viaTd, "restore")).rejects.toMatchObject({ code: "55000" });
  });

  it("events: remove stamps, restore works for the moderator removal only", async () => {
    const e = (await raw("insert into public.events (created_by, title, starts_at, status) values ($1, 'e', now(), 'published') returning id", [A]))[0]!.id as string;
    await mod(MOD, "event", e, "remove");
    expect((await raw("select removed_by from public.events where id = $1", [e]))[0]!.removed_by).toBe(MOD);
    expect((await mod(MOD, "event", e, "restore")).rows[0]!.ch).toBe(true);
  });
});

describe("suspension: staff check only applies when suspending", () => {
  it("staff cannot be suspended, but a stale staff suspension can be lifted", async () => {
    await expect(run(ADMIN, "select public.admin_set_user_suspended($1, true, $2)", [MOD, REASON])).rejects.toThrow(/staff/);
    await raw("insert into public.account_suspensions (user_id, reason) values ($1, 'was a student then')", [MOD]);
    expect((await run(ADMIN, "select public.admin_set_user_suspended($1, false, $2) as ch", [MOD, REASON])).rows[0]!.ch).toBe(true);
    expect(await raw("select 1 from public.account_suspensions where user_id = $1", [MOD])).toHaveLength(0);
    // positive control: a student is still suspended
    expect((await run(ADMIN, "select public.admin_set_user_suspended($1, true, $2) as ch", [B, REASON])).rows[0]!.ch).toBe(true);
  });
});

describe("AI config: legacy writers are owner-only, wrappers keep working", () => {
  const direct = [
    "select public.admin_set_ai_provider('zz', 'openai', true, null)",
    "select public.admin_set_ai_model(gen_random_uuid(), 'm', 'small', 1, 1, 1, 10, true, false)",
    "select public.admin_set_ai_route('chat', 'free', gen_random_uuid(), '{}', 10)",
    "select public.admin_delete_ai_route('chat', 'free')",
    "select public.admin_set_ai_budget('global', '*', 'day', 5)",
    "select public.admin_delete_ai_budget('global', '*', 'day')",
  ];
  it.each(direct)("%s is denied to an admin", async (sql) => {
    await expect(run(ADMIN, sql)).rejects.toThrow(/permission denied/);
  });
  let prov = "";
  let small = "";
  let big = "";
  it("the reason wrappers succeed for the same admin", async () => {
    prov = (await run(ADMIN, "select public.admin_ai_set_provider('hard-prov', 'openai', true, 'gw', $1) as id", [REASON])).rows[0]!.id;
    small = (await run(ADMIN, "select public.admin_ai_set_model($1, 'sm', 'small', 100000, 200000, 10000, 4000, true, true, $2) as id", [prov, REASON])).rows[0]!.id;
    big = (await run(ADMIN, "select public.admin_ai_set_model($1, 'bg', 'premium', 3000000, 6000000, 300000, 8000, true, false, $2) as id", [prov, REASON])).rows[0]!.id;
    await run(ADMIN, "select public.admin_ai_set_route('chat', 'free', $1, array[$2]::uuid[], 20, $3)", [big, small, REASON]);
    expect(await raw("select 1 from public.ai_task_routes where task = 'chat' and plan = 'free'")).toHaveLength(1);
    expect((await raw("select reason from public.config_versions order by version desc limit 1"))[0]!.reason).toBe(REASON);
  });
  it("routes need enabled models and providers: disabling a used model/provider is blocked and lists the routes", async () => {
    await expect(run(ADMIN, "select public.admin_ai_set_model($1, 'bg', 'premium', 3000000, 6000000, 300000, 8000, false, false, $2)", [prov, REASON])).rejects.toThrow(/disabled model or provider.*chat\/free/);
    await expect(run(ADMIN, "select public.admin_ai_set_model($1, 'sm', 'small', 100000, 200000, 10000, 4000, false, true, $2)", [prov, REASON])).rejects.toThrow(/chat\/free/);
    await expect(run(ADMIN, "select public.admin_ai_set_provider('hard-prov', 'openai', false, 'gw', $1)", [REASON])).rejects.toThrow(/chat\/free/);
    expect((await raw("select enabled from public.ai_providers where id = $1", [prov]))[0]!.enabled).toBe(true);
    // positive control: an unused model and an unused provider can be disabled
    const spare = (await run(ADMIN, "select public.admin_ai_set_model($1, 'spare', 'small', 100000, 200000, 10000, 4000, true, true, $2) as id", [prov, REASON])).rows[0]!.id;
    await run(ADMIN, "select public.admin_ai_set_model($1, 'spare', 'small', 100000, 200000, 10000, 4000, false, true, $2)", [prov, REASON]);
    expect((await raw("select enabled from public.ai_models where id = $1", [spare]))[0]!.enabled).toBe(false);
    await run(ADMIN, "select public.admin_ai_set_provider('unused-prov', 'openai', true, null, $1)", [REASON]);
    await run(ADMIN, "select public.admin_ai_set_provider('unused-prov', 'openai', false, null, $1)", [REASON]);
    // a route cannot point at the disabled model either
    await expect(run(ADMIN, "select public.admin_ai_set_route('quiz', 'free', $1, '{}', 10, $2)", [spare, REASON])).rejects.toThrow(/disabled/);
  });
  it("revert re-validates: a snapshot whose route uses a disabled model is refused and nothing changes", async () => {
    const v = (await raw(
      `insert into public.config_versions (snapshot, action)
       select jsonb_set(snapshot, '{models}', (select jsonb_agg(case when m ->> 'id' = $1 then jsonb_set(m, '{enabled}', 'false') else m end) from jsonb_array_elements(snapshot -> 'models') m)), 'crafted'
       from public.config_versions order by version desc limit 1 returning version`, [big]))[0]!.version;
    await expect(run(ADMIN, "select public.admin_revert_config($1, $2)", [v, REASON])).rejects.toThrow(/disabled model or provider.*chat\/free/);
    expect((await raw("select enabled from public.ai_models where id = $1", [big]))[0]!.enabled).toBe(true);
    expect(await raw("select 1 from public.ai_task_routes where task = 'chat' and plan = 'free'")).toHaveLength(1);
  });
  it("budgets: sanity cap and user <= plan <= global per period", async () => {
    const b = (scope: string, key: string, period: string, limit: number | string) =>
      run(ADMIN, "select public.admin_ai_set_budget($1, $2, $3, $4::bigint, $5)", [scope, key, period, limit, REASON]);
    await expect(b("global", "*", "day", "2000000000000")).rejects.toThrow(/sanity cap/);
    await b("global", "*", "day", 1_000_000);
    await b("plan", "free", "day", 500_000);
    await b("user", "*", "day", 100_000); // user <= plan <= global: accepted
    await expect(b("plan", "plus", "day", 2_000_000)).rejects.toThrow(/exceeds the global/);
    await expect(b("user", "*", "day", 600_000)).rejects.toThrow(/exceeds a plan budget/);
    await expect(b("global", "*", "day", 400_000)).rejects.toThrow(/exceeds the global/);
    // another period is independent
    await b("plan", "free", "month", 9_000_000);
    expect((await raw("select hard_limit_micro_usd from public.ai_budgets where scope = 'global' and period = 'day'"))[0]!.hard_limit_micro_usd).toBe(1_000_000);
  });
});

describe("prompt_versions: audited RPCs only", () => {
  it("an active prompt cannot be edited in place; changes are new versions, activation needs a reason", async () => {
    const p1 = (await run(ADMIN, "select public.admin_create_prompt_version('hard-sum', 'T1', null, true, $1) as id", [REASON])).rows[0]!.id;
    await expect(run(ADMIN, "update public.prompt_versions set template = 'edited' where id = $1", [p1])).rejects.toThrow(/permission denied/);
    await expect(run(ADMIN, "delete from public.prompt_versions where id = $1", [p1])).rejects.toThrow(/permission denied/);
    await expect(run(ADMIN, "insert into public.prompt_versions (name, version, template) values ('hard-sum', 9, 'x')")).rejects.toThrow(/permission denied/);
    expect((await raw("select template from public.prompt_versions where id = $1", [p1]))[0]!.template).toBe("T1");
    const p2 = (await run(ADMIN, "select public.admin_create_prompt_version('hard-sum', 'T2', null, false, $1) as id", [REASON])).rows[0]!.id;
    await expect(run(ADMIN, "select public.admin_activate_prompt_version($1, 'x')", [p2])).rejects.toThrow(/reason/);
    await expect(run(MOD, "select public.admin_activate_prompt_version($1, $2)", [p2, REASON])).rejects.toThrow(/admin privileges required/);
    await run(ADMIN, "select public.admin_activate_prompt_version($1, $2)", [p2, REASON]);
    expect((await raw("select id from public.prompt_versions where name = 'hard-sum' and is_active")).map((r) => r.id)).toEqual([p2]);
    expect((await raw("select metadata from public.audit_logs where action = 'prompt.activate' and entity_id = $1", [p2]))[0]!.metadata.reason).toBe(REASON);
  });
});

describe("system_config: RPC writes only, server-side validation", () => {
  const set = (key: string, json: string, reason = REASON) => run(ADMIN, "select public.admin_set_system_config($1, $2::jsonb, $3) as v", [key, json, reason]);
  it("admins cannot write the table directly", async () => {
    await expect(run(ADMIN, "insert into public.system_config (key, value) values ('signup.enabled', 'true')")).rejects.toThrow(/permission denied/);
    await set("signup.enabled", "true");
    await expect(run(ADMIN, "update public.system_config set value = 'false' where key = 'signup.enabled'")).rejects.toThrow(/permission denied/);
    await expect(run(ADMIN, "delete from public.system_config where key = 'signup.enabled'")).rejects.toThrow(/permission denied/);
    expect((await raw("select value from public.system_config where key = 'signup.enabled'"))[0]!.value).toBe(true);
  });
  it("rejects javascript:/http URLs, negative and out-of-range numbers, wrong types and unknown keys", async () => {
    for (const bad of ['"javascript:alert(1)"', '"http://example.az/help"', '"https://user:pw@example.az/"', '"https://exa mple.az"', "5", "null"]) {
      await expect(set("support.contact_url", bad), bad).rejects.toMatchObject({ code: "22023" });
    }
    for (const bad of ["-1", "0", "201", "1.5", '"25"', "true", "1e9"]) {
      await expect(set("uploads.max_file_mb", bad), bad).rejects.toMatchObject({ code: "22023" });
    }
    await expect(set("signup.enabled", '"yes"')).rejects.toMatchObject({ code: "22023" });
    await expect(set("maintenance.mode", '{"enabled":"yes"}')).rejects.toMatchObject({ code: "22023" });
    await expect(set("maintenance.mode", '{"enabled":true,"extra":1}')).rejects.toMatchObject({ code: "22023" });
    await expect(set("maintenance.mode", '{"message_key":"x"}')).rejects.toMatchObject({ code: "22023" });
    await expect(set("some.unknown.key", "1")).rejects.toThrow(/unknown config key/);
    await expect(run(ADMIN, "select public.admin_set_system_config('maintenance.mode', jsonb_build_object('enabled', true, 'message_key', repeat('x', 30000)), $1)", [REASON])).rejects.toThrow(/20 KB/);
    expect(await raw("select 1 from public.system_config where key in ('support.contact_url', 'uploads.max_file_mb', 'maintenance.mode', 'some.unknown.key')")).toHaveLength(0);
    // positive controls
    await set("support.contact_url", '"https://example.az/help"');
    await set("uploads.max_file_mb", "200");
    await set("uploads.max_file_mb", "1");
    await set("maintenance.mode", '{"enabled":true,"message_key":"admin.maintenance"}');
    await set("maintenance.mode", '{"enabled":false}');
  });
  it("revert reasons are capped at 500 characters including the prefix", async () => {
    const long = "r".repeat(500);
    const v = (await set("uploads.max_file_mb", "20", long)).rows[0]!.v;
    await set("uploads.max_file_mb", "30", long);
    const v3 = (await run(ADMIN, "select public.admin_revert_system_config($1, $2) as v", [v, long])).rows[0]!.v;
    const rec = (await raw("select reason, value from public.system_config_versions where id = $1", [v3]))[0]!;
    expect(rec.reason).toHaveLength(500);
    expect(rec.reason.startsWith(`revert to v${v}: `)).toBe(true);
    expect(rec.value).toBe(20);
  });
  it("template revert accepts a 500-character reason", async () => {
    const long = "t".repeat(500);
    await run(ADMIN, "select public.admin_set_notification_template('hard.tpl', 'en', 'One', 'a', $1)", [REASON]);
    const v = (await raw("select id from public.notification_template_versions where key = 'hard.tpl' order by id limit 1"))[0]!.id;
    await run(ADMIN, "select public.admin_set_notification_template('hard.tpl', 'en', 'Two', 'b', $1)", [REASON]);
    await run(ADMIN, "select public.admin_revert_notification_template($1, $2)", [v, long]);
    expect((await raw("select title from public.notification_templates where key = 'hard.tpl' and locale = 'en'"))[0]!.title).toBe("One");
  });
  it("baseline versions: pre-console rows become revertable; re-running the backfill is idempotent", async () => {
    await raw("insert into public.system_config (key, value) values ('legacy.flag', '{\"a\":1}')");
    await raw("insert into public.notification_templates (key, locale, title, body) values ('legacy.tpl', 'en', 'Old title', 'old body')");
    const sql = readFileSync(path.resolve(__dirname, "../../../supabase/migrations/20260101004800_admin_console_hardening.sql"), "utf8");
    const backfill = sql.slice(sql.indexOf("-- ---------------------------------------------------------------- baselines"));
    const counts = async () => (await raw("select (select count(*) from public.system_config_versions) a, (select count(*) from public.notification_template_versions) b, (select count(*) from public.config_versions) c"))[0]!;
    await db.exec(backfill);
    const first = await counts();
    await db.exec(backfill);
    expect(await counts()).toEqual(first);
    expect(await raw("select 1 from public.system_config_versions where key = 'legacy.flag' and value = '{\"a\":1}'::jsonb")).toHaveLength(1);
    // the baseline is a revert target for an unknown (pre-console) key too
    await raw("delete from public.system_config where key = 'legacy.flag'");
    const v = (await raw("select id from public.system_config_versions where key = 'legacy.flag' order by id limit 1"))[0]!.id;
    await run(ADMIN, "select public.admin_revert_system_config($1, $2)", [v, REASON]);
    expect((await raw("select value from public.system_config where key = 'legacy.flag'"))[0]!.value).toEqual({ a: 1 });
    const t = (await raw("select id from public.notification_template_versions where key = 'legacy.tpl' and locale = 'en' order by id limit 1"))[0]!.id;
    await run(ADMIN, "select public.admin_set_notification_template('legacy.tpl', 'en', 'New', 'new', $1)", [REASON]);
    await run(ADMIN, "select public.admin_revert_notification_template($1, $2)", [t, REASON]);
    expect((await raw("select title from public.notification_templates where key = 'legacy.tpl' and locale = 'en'"))[0]!.title).toBe("Old title");
  });
});
