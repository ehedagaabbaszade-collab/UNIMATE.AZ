import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { affected, asAnon, asService, asUser, createTestDb, ids, seedFixtures, select } from "./harness";

// Migration 20260101003800: purge claim RPCs, first-attempt record, template rendering, revert reason, column grant.
let db: PGlite;
beforeAll(async () => {
  db = await createTestDb({ seed: true });
  await seedFixtures(db);
}, 120_000);
afterAll(async () => {
  await db.close();
});

const raw = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows;
const run = (uid: string, sql: string, params: unknown[] = []) => asUser(db, uid, (tx) => tx.query<Record<string, any>>(sql, params));
const svc = async (sql: string, params: unknown[] = []) => (await asService(db, (tx) => tx.query<Record<string, any>>(sql, params))).rows;
let n = 0;
const newUser = async () => {
  n++;
  const id = `00000000-0000-4000-8000-0000008${String(n).padStart(5, "0")}`;
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `sh${n}@example.test`]);
  return id;
};
const claim = async (uid: string) => (await svc("select public.claim_account_purge($1) as r", [uid]))[0]!.r as boolean;

describe("account purge claim", () => {
  it("is service_role only", async () => {
    const u = await newUser();
    for (const sql of ["select public.claim_account_purge($1)", "select public.record_account_purge_failure($1, 'x')", "select public.record_account_purged($1)"]) {
      await expect(run(u, sql, [u])).rejects.toThrow(/permission denied/);
      await expect(asAnon(db, (tx) => tx.query(sql, [u]))).rejects.toThrow(/permission denied/);
    }
  });

  it("refuses a user whose request is not pending/due, claims once, and blocks cancel while claimed", async () => {
    const u = await newUser();
    expect(await claim(u)).toBe(false); // no request at all
    await run(u, "select public.request_account_deletion()");
    expect(await claim(u)).toBe(false); // pending but grace not over
    await raw("update public.account_deletion_requests set scheduled_for = now() - interval '1 day', requested_at = now() - interval '15 days' where user_id = $1", [u]);
    expect((await svc("select count(*)::int c from public.due_account_deletions(500) x where x = $1", [u]))[0]!.c).toBe(1);
    expect(await claim(u)).toBe(true);
    expect(await claim(u)).toBe(false); // already claimed by a live worker
    expect((await svc("select count(*)::int c from public.due_account_deletions(500) x where x = $1", [u]))[0]!.c).toBe(0);
    // the user cannot cancel between the claim and deleteUser
    expect((await run(u, "select public.cancel_account_deletion() as r")).rows[0]!.r).toBe(false);
    expect((await raw("select status from public.account_deletion_requests where user_id = $1", [u]))[0]!.status).toBe("pending");
    // a crashed worker's claim expires and can be taken again
    await raw("update public.account_deletion_requests set purge_claimed_at = now() - interval '1 hour' where user_id = $1", [u]);
    expect(await claim(u)).toBe(true);
  });

  it("a cancelled request cannot be claimed (positive control: cancel works before a claim)", async () => {
    const u = await newUser();
    await run(u, "select public.request_account_deletion()");
    await raw("update public.account_deletion_requests set scheduled_for = now() - interval '1 day', requested_at = now() - interval '15 days' where user_id = $1", [u]);
    expect((await run(u, "select public.cancel_account_deletion() as r")).rows[0]!.r).toBe(true);
    expect(await claim(u)).toBe(false);
  });

  it("failures bump attempts, release the claim, audit, and sort the stuck user AFTER fresh ones", async () => {
    const stuck = await newUser();
    const fresh = await newUser();
    await raw("delete from public.account_deletion_requests");
    await run(stuck, "select public.request_account_deletion()");
    await raw("update public.account_deletion_requests set scheduled_for = now() - interval '3 days', requested_at = now() - interval '20 days' where user_id = $1", [stuck]);
    await run(fresh, "select public.request_account_deletion()");
    await raw("update public.account_deletion_requests set scheduled_for = now() - interval '1 day', requested_at = now() - interval '15 days' where user_id = $1", [fresh]);
    // stuck is older, so it sorts first until it fails
    expect((await svc("select x from public.due_account_deletions(10) x")).map((r) => r.x)).toEqual([stuck, fresh]);
    expect(await claim(stuck)).toBe(true);
    await svc("select public.record_account_purge_failure($1, 'storage_cap')", [stuck]);
    const row = (await raw("select purge_attempts, last_purge_error, purge_claimed_at from public.account_deletion_requests where user_id = $1", [stuck]))[0]!;
    expect(row).toMatchObject({ purge_attempts: 1, last_purge_error: "storage_cap", purge_claimed_at: null });
    expect((await svc("select x from public.due_account_deletions(10) x")).map((r) => r.x)).toEqual([fresh, stuck]);
    expect((await raw("select metadata from public.audit_logs where action = 'account.purge_failed' and entity_id = $1", [stuck]))[0]!.metadata).toMatchObject({ reason: "storage_cap", attempts: 1 });
  });

  it("record_account_purged refuses while the account exists, then writes one account.purged row", async () => {
    const u = await newUser();
    await expect(svc("select public.record_account_purged($1)", [u])).rejects.toThrow(/still exists/);
    expect(await raw("select 1 from public.audit_logs where action = 'account.purged' and entity_id = $1", [u])).toEqual([]);
    await raw("delete from auth.users where id = $1", [u]);
    await svc("select public.record_account_purged($1)", [u]);
    await svc("select public.record_account_purged($1)", [u]);
    expect((await raw("select metadata from public.audit_logs where action = 'account.purged' and entity_id = $1", [u])).map((r) => r.metadata)).toEqual([{ via: "purge-accounts" }]);
  });
});

describe("quiz first attempt is durable", () => {
  const mkQuiz = async (owner: string) => {
    const quiz = (await raw("insert into public.quizzes (user_id, title, server_generated) values ($1, 'Q', true) returning id", [owner]))[0]!.id as string;
    const qs: string[] = [];
    for (let i = 0; i < 3; i++)
      qs.push((await raw("insert into public.questions (quiz_id, position, kind, prompt, options, answer, explanation) values ($1, $2, 'mcq', $3, '[\"a\",\"b\",\"c\"]'::jsonb, 'b', 'e') returning id", [quiz, i, `p${i}`]))[0]!.id as string);
    return { id: quiz, qs, correct: Object.fromEntries(qs.map((q) => [q, 1])) };
  };
  const submit = async (uid: string, quiz: string, answers: unknown, attempt: string) =>
    (await run(uid, "select public.submit_quiz_attempt($1, $2::jsonb, $3) as r", [quiz, JSON.stringify(answers), attempt])).rows[0]!.r as Record<string, any>;
  let k = 0;
  const uuid = () => `d0000000-0000-4000-8000-${String(++k + 5000).padStart(12, "0")}`;

  it("students cannot delete or truncate attempts (positive control: they can still read them)", async () => {
    const a = await newUser();
    const z = await mkQuiz(a);
    await submit(a, z.id, {}, uuid());
    expect((await select(db, "authenticated", a, "select id from public.attempts where quiz_id = $1", [z.id])).length).toBe(1);
    await expect(run(a, "delete from public.attempts where quiz_id = $1", [z.id])).rejects.toThrow(/permission denied/);
    await expect(run(a, "truncate public.attempts")).rejects.toThrow(/permission denied/);
    await expect(run(a, "select * from public.quiz_first_attempts")).rejects.toThrow(/permission denied/);
    expect((await raw("select count(*)::int c from public.attempts where quiz_id = $1", [z.id]))[0]!.c).toBe(1);
  });

  it("submit {} then losing the attempt row then resubmitting a perfect quiz no longer pays", async () => {
    const a = await newUser();
    const z = await mkQuiz(a);
    const empty = await submit(a, z.id, {}, uuid());
    expect(empty).toMatchObject({ xp_awarded: 0, xp_eligible: true });
    expect((await raw("select count(*)::int c from public.quiz_first_attempts where quiz_id = $1 and user_id = $2", [z.id, a]))[0]!.c).toBe(1);
    // even if the attempts rows vanished by any path (old DELETE bypass, admin cleanup), the durable record remains
    await raw("delete from public.attempts where quiz_id = $1", [z.id]);
    const again = await submit(a, z.id, z.correct, uuid());
    expect(again).toMatchObject({ score: 3, xp_awarded: 0, xp_eligible: false });
  });

  it("two different attempt ids submitted together pay exactly once", async () => {
    const a = await newUser();
    const z = await mkQuiz(a);
    const rs = await Promise.all([submit(a, z.id, z.correct, uuid()), submit(a, z.id, z.correct, uuid())]);
    expect(rs.filter((r) => r.xp_awarded > 0)).toHaveLength(1);
    expect(rs.filter((r) => r.xp_eligible)).toHaveLength(1);
    expect((await raw("select count(*)::int c from public.attempts where quiz_id = $1", [z.id]))[0]!.c).toBe(2);
    expect((await raw("select count(*)::int c from public.xp_events where user_id = $1", [a]))[0]!.c).toBe(3);
  });
});

describe("render_template_text is single-pass", () => {
  const render = async (t: string, p: unknown) => (await raw("select public.render_template_text($1, $2::jsonb) as r", [t, JSON.stringify(p)]))[0]!.r;
  it("never re-expands {key} inside substituted values, in any key order", async () => {
    expect(await render("Hi {name}, plan {plan}", { name: "{plan}", plan: "Pro" })).toBe("Hi {plan}, plan Pro");
    expect(await render("Hi {name}, plan {plan}", { plan: "{name}", name: "Ann" })).toBe("Hi Ann, plan {name}");
  });
  it("keeps unknown placeholders, renders null as empty, repeats a placeholder", async () => {
    expect(await render("{a}-{b}-{a}-{c}", { a: "1", b: null })).toBe("1--1-{c}");
    expect(await render("no placeholders", {})).toBe("no placeholders");
  });
});

describe("admin_revert_system_content needs a reason; system_content hides updated_by", () => {
  it("rejects a null/short reason before touching anything, accepts a real one", async () => {
    await run(ids.admin, "select public.admin_set_system_content('rev.k','az','{\"t\":1}'::jsonb,'first draft')");
    await run(ids.admin, "select public.admin_set_system_content('rev.k','az','{\"t\":2}'::jsonb,'second draft')");
    await expect(run(ids.admin, "select public.admin_revert_system_content('rev.k','az',1,null)")).rejects.toThrow(/reason/);
    await expect(run(ids.admin, "select public.admin_revert_system_content('rev.k','az',1,'x')")).rejects.toThrow(/reason/);
    expect((await raw("select version from public.system_content where key = 'rev.k'"))[0]!.version).toBe(2);
    expect((await run(ids.admin, "select public.admin_revert_system_content('rev.k','az',1,'bad edit') v")).rows[0]!.v).toBe(3);
  });

  it("anon and authenticated read content but not updated_by (positive control: body is readable)", async () => {
    expect((await select(db, "anon", null, "select body, version from public.system_content where key = 'rev.k'")).length).toBe(1);
    await expect(asAnon(db, (tx) => tx.query("select updated_by from public.system_content"))).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, (tx) => tx.query("select * from public.system_content"))).rejects.toThrow(/permission denied/);
    await expect(run(ids.alice, "select updated_by from public.system_content")).rejects.toThrow(/permission denied/);
    expect(await affected(db, "anon", null, "update public.system_content set body = '{}'")).toBe(0);
  });
});
