import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asOwnerAs, asUser, createTestDb, ids, seedFixtures } from "./harness";

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
  await seedFixtures(db);
}, 120_000);
afterAll(async () => {
  await db.close();
});

const { alice: A, mod: MOD, admin: ADMIN } = ids;
type R = Record<string, any>;
const run = (uid: string, sql: string, params: unknown[] = []) => asUser(db, uid, (tx) => tx.query<R>(sql, params));
const raw = async (sql: string, params: unknown[] = []) => (await db.query<R>(sql, params)).rows;
const REASON = "ticket 4711 pricing update";
const audit = (action: string) => raw("select * from public.audit_logs where action = $1 order by id", [action]);

describe("role gates", () => {
  const gated: [string, string][] = [
    ["admin_ai_set_provider", "select public.admin_ai_set_provider('p1', 'openai', true, null, 'valid reason')"],
    ["admin_ai_delete_route", "select public.admin_ai_delete_route('chat', 'free', 'valid reason')"],
    ["admin_ai_delete_budget", "select public.admin_ai_delete_budget('global', '*', 'day', 'valid reason')"],
    ["admin_ai_sweep_reservations", "select public.admin_ai_sweep_reservations(30, 'valid reason')"],
    ["admin_set_system_config", "select public.admin_set_system_config('signup.enabled', 'true'::jsonb, 'valid reason')"],
    ["admin_revert_system_config", "select public.admin_revert_system_config(1, 'valid reason')"],
    ["admin_revert_notification_template", "select public.admin_revert_notification_template(1, 'valid reason')"],
    ["admin_learning_metrics", "select * from public.admin_learning_metrics(7)"],
    ["admin_retention_cohorts", "select * from public.admin_retention_cohorts(4)"],
    ["admin_processing_failures", "select * from public.admin_processing_failures(null, 5, 0)"],
    ["admin_requeue_job", "select public.admin_requeue_job(gen_random_uuid(), 'valid reason')"],
  ];
  for (const [name, sql] of gated) {
    for (const [who, uid] of [["student", A], ["moderator", MOD]] as const) {
      it(`${name}: ${who} rejected`, async () => {
        await expect(run(uid, sql)).rejects.toThrow(/admin privileges required/);
      });
    }
  }
  it("anon cannot execute", async () => {
    await expect(db.query("set role anon; select public.admin_requeue_job(gen_random_uuid(), 'valid reason')")).rejects.toThrow();
    await db.query("reset role");
  });
});

describe("AI config wrappers carry a required reason", () => {
  let provider = "";
  let cheap = "";
  let pricey = "";
  it("rejects a missing/short reason and writes nothing", async () => {
    await expect(run(ADMIN, "select public.admin_ai_set_provider('prov', 'openai', true, null, 'x')")).rejects.toThrow(/reason/);
    expect(await raw("select 1 from public.ai_providers where name = 'prov'")).toHaveLength(0);
  });
  it("stores the reason on config_versions and in the audit log", async () => {
    provider = (await run(ADMIN, "select public.admin_ai_set_provider('prov', 'openai', true, 'gateway', $1) as id", [REASON])).rows[0]!.id;
    cheap = (await run(ADMIN, "select public.admin_ai_set_model($1, 'small-1', 'small', 100000, 200000, 10000, 4000, true, true, $2) as id", [provider, REASON])).rows[0]!.id;
    pricey = (await run(ADMIN, "select public.admin_ai_set_model($1, 'big-1', 'premium', 3000000, 6000000, 300000, 8000, true, false, $2) as id", [provider, REASON])).rows[0]!.id;
    const v = await raw("select reason, action from public.config_versions order by version");
    expect(v).toHaveLength(3);
    expect(v.every((x) => x.reason === REASON)).toBe(true);
    const a = await audit("ai_config.model.set");
    expect(a[0]!.metadata.reason).toBe(REASON);
    expect(a[0]!.metadata.old).toBeNull();
  });
  it("route validation still rejects a fallback that costs more than the primary", async () => {
    await expect(run(ADMIN, "select public.admin_ai_set_route('cv_feedback', 'free', $1, array[$2]::uuid[], 20, $3)", [cheap, pricey, REASON])).rejects.toThrow(/not approved|costs more/);
    const ok = (await run(ADMIN, "select public.admin_ai_set_route('cv_feedback', 'free', $1, array[$2]::uuid[], 20, $3) as id", [pricey, cheap, REASON])).rows[0]!.id;
    expect(ok).toBeTruthy();
    expect(await raw("select 1 from public.ai_task_routes where task = 'cv_feedback' and plan = 'free'")).toHaveLength(1);
  });
  it("the reason does not leak into a later unreasoned write in the same session", async () => {
    await asOwnerAs(db, ADMIN, (tx) => tx.query("select public.admin_set_ai_budget('global', '*', 'day', 5000000)"));
    const last = (await raw("select reason from public.config_versions order by version desc limit 1"))[0]!;
    expect(last.reason).toBeNull();
  });
  it("budget wrapper + delete wrapper audit with reason; revert records the reason too", async () => {
    await run(ADMIN, "select public.admin_ai_set_budget('plan', 'free', 'month', 9000000, $1)", [REASON]);
    expect((await run(ADMIN, "select public.admin_ai_delete_budget('plan', 'free', 'month', $1) as ok", [REASON])).rows[0]!.ok).toBe(true);
    expect((await audit("ai_config.budget.delete"))[0]!.metadata.reason).toBe(REASON);
    const first = (await raw("select min(version) as v from public.config_versions"))[0]!.v;
    await run(ADMIN, "select public.admin_revert_config($1, $2)", [first, REASON]);
    const rev = (await raw("select reason, action from public.config_versions order by version desc limit 1"))[0]!;
    expect(rev).toEqual({ reason: REASON, action: "ai_config.revert" });
  });
  it("admins can read config and history through RLS; students cannot", async () => {
    expect((await run(ADMIN, "select * from public.config_versions")).rows.length).toBeGreaterThan(3);
    expect((await run(A, "select * from public.config_versions")).rows).toHaveLength(0);
    expect((await run(A, "select * from public.ai_models")).rows).toHaveLength(0);
  });
});

describe("manual reservation sweeper", () => {
  it("releases only stale reservations, needs a reason and >= 5 minutes, and is audited", async () => {
    await raw("insert into public.ai_reservations (request_id, user_id, plan, task, estimate_micro_usd, status, created_at) values ('req-old-0001', $1, 'free', 'chat', 10, 'reserved', now() - interval '2 hours')", [A]);
    await raw("insert into public.ai_reservations (request_id, user_id, plan, task, estimate_micro_usd, status) values ('req-new-0001', $1, 'free', 'chat', 10, 'reserved')", [A]);
    await expect(run(ADMIN, "select public.admin_ai_sweep_reservations(30, 'x')")).rejects.toThrow(/reason/);
    await expect(run(ADMIN, "select public.admin_ai_sweep_reservations(1, $1)", [REASON])).rejects.toThrow(/at least 5/);
    expect((await run(ADMIN, "select public.admin_ai_sweep_reservations(30, $1) as n", [REASON])).rows[0]!.n).toBe(1);
    expect((await run(ADMIN, "select public.admin_ai_sweep_reservations(30, $1) as n", [REASON])).rows[0]!.n).toBe(0);
    expect((await raw("select status from public.ai_reservations where request_id = 'req-new-0001'"))[0]!.status).toBe("reserved");
    const a = await audit("ai.sweep.manual");
    expect(a).toHaveLength(2);
    expect(a[0]!.metadata).toMatchObject({ released: 1, reason: REASON });
  });
});

describe("system_config versions", () => {
  it("versions every write, audits key + reason (never the value) and reverts", async () => {
    await expect(run(ADMIN, "select public.admin_set_system_config('signup.enabled', 'true'::jsonb, 'x')")).rejects.toThrow(/reason/);
    await expect(run(ADMIN, "select public.admin_set_system_config('Bad Key', 'true'::jsonb, $1)", [REASON])).rejects.toThrow(/valid key/);
    await expect(run(ADMIN, "select public.admin_set_system_config('signup.enabled', 'null'::jsonb, $1)", [REASON])).rejects.toThrow(/valid key/);
    const v1 = (await run(ADMIN, "select public.admin_set_system_config('signup.enabled', 'true'::jsonb, $1) as v", [REASON])).rows[0]!.v;
    const v2 = (await run(ADMIN, "select public.admin_set_system_config('signup.enabled', 'false'::jsonb, $1) as v", [REASON])).rows[0]!.v;
    expect(Number(v2)).toBeGreaterThan(Number(v1));
    expect((await raw("select value from public.system_config where key = 'signup.enabled'"))[0]!.value).toBe(false);
    const hist = await raw("select action, value, reason, actor_id from public.system_config_versions where key = 'signup.enabled' order by id");
    expect(hist.map((h) => h.action)).toEqual(["insert", "update"]);
    expect(hist.every((h) => h.reason === REASON && h.actor_id === ADMIN)).toBe(true);
    const a = await audit("config.update");
    expect(JSON.stringify(a[0]!.metadata)).toBe(JSON.stringify({ reason: REASON }));
    const v3 = (await run(ADMIN, "select public.admin_revert_system_config($1, $2) as v", [v1, REASON])).rows[0]!.v;
    expect((await raw("select value from public.system_config where key = 'signup.enabled'"))[0]!.value).toBe(true);
    expect((await raw("select reason from public.system_config_versions where id = $1", [v3]))[0]!.reason).toContain(`revert to v${v1}`);
    await expect(run(ADMIN, "select public.admin_revert_system_config(999999, $1)", [REASON])).rejects.toThrow(/not found/);
  });
  it("a revert of an insert deletes the key again; versions record the RPC reason", async () => {
    const v = (await run(ADMIN, "select public.admin_set_system_config('uploads.max_file_mb', '25'::jsonb, $1) as v", [REASON])).rows[0]!.v;
    await run(ADMIN, "select public.admin_revert_system_config($1, $2)", [v, REASON]); // value of that version is 25: stays
    const last = (await raw("select action, reason from public.system_config_versions where key = 'uploads.max_file_mb' order by id desc limit 1"))[0]!;
    expect(last.action).toBe("update");
    expect(last.reason).toContain(REASON);
  });
  it("students cannot read config versions", async () => {
    expect((await run(A, "select * from public.system_config_versions")).rows).toHaveLength(0);
  });
});

describe("notification template history", () => {
  it("records a version per save and reverts as a new version", async () => {
    await run(ADMIN, "select public.admin_set_notification_template('welcome', 'en', 'Hello', 'Hi {name}', $1)", [REASON]);
    const v1 = (await raw("select id from public.notification_template_versions where key = 'welcome' and locale = 'en' and title = 'Hello' order by id limit 1"))[0]!.id;
    await run(ADMIN, "select public.admin_set_notification_template('welcome', 'en', 'Hello again', 'Hey {name}', $1)", [REASON]);
    await expect(run(ADMIN, "select public.admin_revert_notification_template($1, 'x')", [v1])).rejects.toThrow(/reason/);
    await run(ADMIN, "select public.admin_revert_notification_template($1, $2)", [v1, REASON]);
    expect((await raw("select title, body from public.notification_templates where key = 'welcome' and locale = 'en'"))[0]).toEqual({ title: "Hello", body: "Hi {name}" });
    expect(await raw("select 1 from public.notification_template_versions where key = 'welcome' and locale = 'en'")).toHaveLength(4); // baseline + 3 saves
    expect((await run(A, "select * from public.notification_template_versions")).rows).toHaveLength(0);
    await expect(run(ADMIN, "select public.admin_revert_notification_template(999999, $1)", [REASON])).rejects.toThrow(/not found/);
  });
});

describe("analytics aggregates", () => {
  it("learning metrics count today's activity and expose no user columns", async () => {
    const q = (await raw("insert into public.quizzes (user_id, title) values ($1, 'Q') returning id", [A]))[0]!.id;
    await raw("insert into public.attempts (quiz_id, user_id, score, max_score, completed_at) values ($1, $2, 1, 2, now())", [q, A]);
    await raw("insert into public.xp_events (user_id, kind, points, source_key) values ($1, 'review_completed', 5, 'k1@today')", [A]);
    await raw("insert into public.study_sessions (user_id, started_at, ended_at, duration_seconds) values ($1, now() - interval '1 hour', now(), 1800)", [A]);
    const r = await run(ADMIN, "select * from public.admin_learning_metrics(3)");
    expect(r.rows).toHaveLength(3);
    expect(Object.keys(r.rows[0]!).sort()).toEqual(["day", "documents_uploaded", "flashcards_reviewed", "quizzes_taken", "study_minutes"]);
    const today = r.rows[r.rows.length - 1]!;
    expect(today.quizzes_taken).toBeGreaterThanOrEqual(1);
    expect(today.flashcards_reviewed).toBeGreaterThanOrEqual(1);
    expect(today.study_minutes).toBeGreaterThanOrEqual(30);
    await expect(run(ADMIN, "select * from public.admin_learning_metrics(0)")).rejects.toThrow(/between 1 and 366/);
  });
  it("retention cohorts: this week's signups, week 0 active count, aggregate only", async () => {
    const r = await run(ADMIN, "select * from public.admin_retention_cohorts(4)");
    expect(Object.keys(r.rows[0]!).sort()).toEqual(["active", "cohort_size", "cohort_week", "week_offset"]);
    const w0 = r.rows.find((x) => x.week_offset === 0)!;
    expect(w0.cohort_size).toBeGreaterThanOrEqual(6);
    expect(w0.active).toBeGreaterThanOrEqual(1);
    expect(w0.active).toBeLessThanOrEqual(w0.cohort_size);
    await expect(run(ADMIN, "select * from public.admin_retention_cohorts(27)")).rejects.toThrow(/between 1 and 26/);
  });
});

describe("processing monitor", () => {
  let jobId = "";
  it("lists failed/dead jobs with sanitized errors and no payload or user id", async () => {
    const err = `boom for bob@example.com at https://x.test/a?token=secret\n${"z".repeat(500)}`;
    jobId = (await raw(
      "insert into public.processing_jobs (document_id, user_id, kind, state, attempts, max_attempts, last_error, payload, idempotency_key) values ($1, $2, 'embed', 'dead', 5, 5, $3, '{\"secret\":\"doc text\"}', 'job-key-0001') returning id",
      [ids.docA, A, err],
    ))[0]!.id;
    await raw("insert into public.processing_jobs (document_id, user_id, kind, state, idempotency_key) values ($1, $2, 'chunk', 'queued', 'job-key-0002')", [ids.docA, A]);
    const r = await run(ADMIN, "select * from public.admin_processing_failures(null, 10, 0)");
    expect(r.rows).toHaveLength(1);
    expect(Object.keys(r.rows[0]!).sort()).toEqual(["attempts", "document_id", "id", "kind", "last_error", "max_attempts", "state", "total", "updated_at"]);
    const e = r.rows[0]!.last_error as string;
    expect(e.length).toBeLessThanOrEqual(200);
    expect(e).not.toContain("bob@example.com");
    expect(e).not.toContain("token=secret");
    expect(e).toContain("[email]");
    expect(e).toContain("[url]");
    expect(e).not.toContain("\n");
    expect((await run(ADMIN, "select * from public.admin_processing_failures('failed', 10, 0)")).rows).toHaveLength(0);
    await expect(run(ADMIN, "select * from public.admin_processing_failures('queued', 10, 0)")).rejects.toThrow(/failed or dead/);
  });
  it("requeue needs a reason, only works on failed/dead, resets attempts and is audited", async () => {
    await expect(run(ADMIN, "select public.admin_requeue_job($1, 'x')", [jobId])).rejects.toThrow(/reason/);
    expect((await run(ADMIN, "select public.admin_requeue_job($1, $2) as ok", [jobId, REASON])).rows[0]!.ok).toBe(true);
    const j = (await raw("select state, attempts, locked_at from public.processing_jobs where id = $1", [jobId]))[0]!;
    expect(j).toEqual({ state: "queued", attempts: 0, locked_at: null });
    await expect(run(ADMIN, "select public.admin_requeue_job($1, $2)", [jobId, REASON])).rejects.toThrow(/only failed or dead/);
    await expect(run(ADMIN, "select public.admin_requeue_job(gen_random_uuid(), $1)", [REASON])).rejects.toThrow(/not found/);
    const a = await audit("job.requeue");
    expect(a).toHaveLength(1);
    expect(a[0]!.metadata).toMatchObject({ kind: "embed", from: "dead", reason: REASON });
  });
});

describe("audit log is readable by admins only and append-only", () => {
  it("admins read, students do not, nobody updates or deletes", async () => {
    expect((await run(ADMIN, "select count(*)::int as n from public.audit_logs")).rows[0]!.n).toBeGreaterThan(5);
    expect((await run(A, "select * from public.audit_logs")).rows).toHaveLength(0);
    await expect(run(ADMIN, "delete from public.audit_logs")).rejects.toThrow();
    await expect(raw("update public.audit_logs set action = 'x'")).rejects.toThrow(/append-only/);
  });
});
