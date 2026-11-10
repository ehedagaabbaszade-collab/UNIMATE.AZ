import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asService } from "../../packages/db/src/harness";
import { kit, newDb } from "./helpers";

// Journey (f): request -> cancel; request -> grace elapsed -> purge leaves no rows; export before purge is own data only.
let db: PGlite;
let k: ReturnType<typeof kit>;
const purge = async (u: string) => (await asService(db, (tx) => tx.query<any>("select public.purge_due_account_deletions(array[$1]::uuid[]) as n", [u]))).rows[0]!.n as number;
const fastForward = (u: string) =>
  k.raw("update public.account_deletion_requests set scheduled_for = now() - interval '1 day', requested_at = now() - interval '15 days' where user_id = $1 and status = 'pending'", [u]);

beforeAll(async () => {
  db = await newDb();
  k = kit(db);
}, 120_000);
afterAll(async () => {
  await db.close();
});

async function seedOwnData(u: string, tag: string) {
  await k.raw("insert into public.documents (user_id, title, storage_path, idempotency_key) values ($1, $2, $3, $4)", [u, `${tag} document`, `${u}/d.pdf`, `idem-${tag}-${u}`]);
  const c = (await k.one(u, "select public.create_community($1, 'course', 'public') as id", [`${tag} community`])).id as string;
  await k.run(u, "select public.create_post($1, $2, 'body', 'post', false)", [c, `${tag} post`]);
  await k.raw("insert into public.xp_events (user_id, kind, points, source_key) values ($1, 'quiz_correct', 7, $2)", [u, `${tag}-xp`]);
}

describe("account deletion journey", () => {
  it("cancel keeps everything; a later request purges after the grace period; nothing remains", async () => {
    const victim = await k.user({ name: "Victim Zeynəb" });
    const bystander = await k.user({ name: "Bystander" });
    await seedOwnData(victim, "victimdata");
    await seedOwnData(bystander, "bystanderdata");

    // export before purge: only the caller's own data
    const mine = (await k.one(victim, "select public.export_my_data() as j")).j as Record<string, any>;
    const text = JSON.stringify(mine);
    expect(mine.profile.id).toBe(victim);
    expect(text).toContain("victimdata document");
    expect(text).not.toContain("bystanderdata");
    expect(text).not.toContain(bystander);
    // anonymous callers cannot export
    await expect(db.query("select public.export_my_data()")).rejects.toThrow(/not authenticated|permission denied/);

    // request -> cancel (scheduled for ~14 days); the purge ignores cancelled requests even when "due"
    const when = (await k.one(victim, "select public.request_account_deletion() as t")).t as Date;
    expect(when.getTime()).toBeGreaterThan(Date.now() + 13 * 86400_000);
    expect((await k.one(bystander, "select public.cancel_account_deletion() as ok")).ok).toBe(false); // nothing of theirs to cancel
    expect((await k.one(victim, "select public.cancel_account_deletion() as ok")).ok).toBe(true);
    await k.raw("update public.account_deletion_requests set scheduled_for = now() - interval '1 day', requested_at = now() - interval '20 days' where user_id = $1", [victim]);
    expect(await purge(victim)).toBe(0);
    expect((await k.raw("select 1 from public.profiles where id = $1", [victim])).length).toBe(1);

    // request again; not purged before the grace period, purged after it
    await k.run(victim, "select public.request_account_deletion()");
    expect(await purge(victim)).toBe(0);
    // students cannot run the purge
    await expect(k.run(victim, "select public.purge_due_account_deletions(array[$1]::uuid[])", [victim])).rejects.toThrow(/permission denied/);
    await fastForward(victim);
    expect(await purge(victim)).toBe(1);

    // no row anywhere in public mentions the victim (audit_logs keeps only an opaque, actor-less record)
    expect(await k.raw("select 1 from auth.users where id = $1", [victim])).toEqual([]);
    const tables = await k.raw("select tablename from pg_tables where schemaname = 'public' order by 1");
    const hits: string[] = [];
    for (const { tablename } of tables) {
      if (tablename === "audit_logs") continue;
      const c = (await k.raw(`select count(*)::int c from public."${tablename}" t where t::text ilike '%' || $1 || '%'`, [victim]))[0]!.c;
      if (c) hits.push(`${tablename}=${c}`);
    }
    expect(hits).toEqual([]);
    expect(await k.raw("select 1 from public.audit_logs where actor_id = $1", [victim])).toEqual([]);
    // the bystander is untouched
    expect((await k.raw("select count(*)::int c from public.documents where user_id = $1", [bystander]))[0]!.c).toBe(1);
    expect((await k.raw("select count(*)::int c from public.xp_events where user_id = $1", [bystander]))[0]!.c).toBe(1);
  }, 60_000);
});
