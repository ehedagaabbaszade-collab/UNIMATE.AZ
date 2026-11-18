import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asService, asUser, createTestDb } from "./harness";

// Account deletion verification. PGlite cannot run GoTrue or Storage, so this proves the SQL part only: deleting the
// auth.users row (what purge_due_account_deletions does, and what GoTrue's admin deleteUser does) removes EVERY row
// that belongs to the user. See docs/ACCOUNT_DELETION.md for the hosted-Supabase specifics that cannot be tested here.
//
// The test discovers every foreign key that points at public.profiles / auth.users from pg_constraint, seeds one real
// row per (table, column) pair through a generic seeder (with a few overrides for check-constrained columns), asserts
// the seed worked (positive control: count > 0), purges, and asserts zero remain. A new table that the seeder cannot
// fill makes the test fail loudly instead of silently skipping it.

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb({ seed: true });
}, 120_000);
afterAll(async () => {
  await db.close();
});

const q = async <T = Record<string, any>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows as T[];
let n = 0;
const newUser = async () => {
  n++;
  const id = `00000000-0000-4000-8000-0000006${String(n).padStart(5, "0")}`;
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `del${n}@example.test`]);
  return id;
};

interface Fk {
  table: string;
  col: string;
  ref: string; // 'profiles' | 'users' | other table
  refCol: string;
  onDelete: string; // c, n, a, r, d
  notNull: boolean;
}
// Column values the generic type-based seeder cannot guess (CHECK constraints). {uid}/{other} are substituted.
const OVERRIDES: Record<string, Record<string, string>> = {
  audit_logs: { action: "'seed.action'" },
  documents: { storage_path: "'{uid}/' || gen_random_uuid()::text || '.pdf'", idempotency_key: "'idem-' || gen_random_uuid()::text", title: "'Seed doc'" },
  processing_jobs: { kind: "'chunk'", idempotency_key: "'job-' || gen_random_uuid()::text" },
  notifications: { kind: "'seed'", title: "'t'" },
  xp_events: { kind: "'seed'", points: "5" },
  achievements: { name: `'{"az":"a","tr":"a","en":"a","ru":"a"}'::jsonb`, description: `'{"az":"a","tr":"a","en":"a","ru":"a"}'::jsonb`, criteria: `'{"metric":"xp_total","target":1}'::jsonb` },
  challenges: { title: `'{"az":"a","tr":"a","en":"a","ru":"a"}'::jsonb`, description: `'{"az":"a","tr":"a","en":"a","ru":"a"}'::jsonb`, criteria: `'{"metric":"xp","target":1}'::jsonb`, ends_at: "now() + interval '1 day'" },
  ai_usage: { feature: "'chat'" },
  ai_rate_limits: { task: "'chat'" },
  ai_reservations: { request_id: "'req-' || gen_random_uuid()::text", plan: "'free'" },
  class_exams: { questions: `'[{"id":"q1","kind":"open","text":"x","options":[],"points":1}]'::jsonb` },
  generation_cache: { params_hash: "'hash-' || substr(md5(random()::text), 1, 12)", output: "'{}'::jsonb" },
  prompt_versions: { name: "'seed-' || gen_random_uuid()::text", version: "1", template: "'t'" },
  usage_counters: { kind: "'ai_message'" },
  conversations: { title: "'Seed'" },
  enrollments: { term: "'2026-fall'" },
  communities: { name: "'Seed community'", slug: "'seed-' || substr(md5(random()::text), 1, 10)" },
  posts: { title: "'Seed post'", body: "'body'", author_id: "'{other}'" },
  comments: { body: "'comment'" },
  resources: { uploader_id: "'{uid}'", title: "'Seed resource'", storage_path: "'{uid}/' || gen_random_uuid()::text || '.pdf'" },
  takedown_requests: { reason: "'seed reason text'", description: "'seed description text'" },
  events: { title: "'Seed event'", starts_at: "now()" },
  job_listings: { title: "'Seed job'" },
  organizations: { name: "'seed-org-' || gen_random_uuid()::text" },
  opportunities: { kind: "'internship'", title: "'Seed opportunity'", apply_url: "'https://example.org/seed'" },
  career_ai_cache: { task: "'cv_feedback'" },
  tasks: { title: "'Seed task'" },
  exams: { title: "'Seed exam'", starts_at: "now()" },
  timetable_entries: { title: "'Seed class'", weekday: "1", start_time: "'09:00'", end_time: "'10:00'" },
  summaries: { content: "'c'" },
  quizzes: { title: "'Seed'" },
  flashcards: { front: "'f'", back: "'b'" },
  notification_templates: { key: "'seed_' || substr(md5(random()::text), 1, 8)", locale: "'az'", title: "'t'" },
  system_content: { key: "'seed-' || substr(md5(random()::text), 1, 8)", locale: "'az'", body: "'{}'::jsonb" },
  system_content_versions: { key: "'seed'", locale: "'az'", version: "1", body: "'{}'::jsonb" },
  system_config: { key: "'seed.' || substr(md5(random()::text), 1, 8)", value: "'1'::jsonb" },
  config_versions: { action: "'seed'", snapshot: "'{}'::jsonb" },
  subscriptions: { plan: "'plus'", status: "'active'" },
  account_deletion_requests: { status: "'pending'" },
  event_rsvps: { status: "'going'" },
  campus_actions: { kind: "'seed'" },
  reactions: { post_id: "(select id from public.posts order by created_at limit 1)" },
};
// reports: exactly one target column may be set (num_nonnulls = 1); handled per pair in the seeder.

async function discover(): Promise<Fk[]> {
  return q<Fk>(`
    select c.conrelid::regclass::text as "table", a.attname as col,
           split_part(c.confrelid::regclass::text, '.', 2) as ref_schema_dummy, c.confrelid::regclass::text as ref,
           fa.attname as "refCol", c.confdeltype as "onDelete", a.attnotnull as "notNull"
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_attribute fa on fa.attrelid = c.confrelid and fa.attnum = c.confkey[1]
    where c.contype = 'f' and array_length(c.conkey, 1) = 1
      and c.conrelid::regclass::text not like 'auth.%' and c.conrelid::regclass::text not like 'storage.%'`);
}

describe("account purge removes every row owned by the user", () => {
  it("discovers the FK graph (guards against the seeder silently missing tables)", async () => {
    const fks = await discover();
    const toProfiles = fks.filter((f) => f.ref === "profiles");
    expect(toProfiles.length).toBeGreaterThan(40);
    expect(new Set(toProfiles.map((f) => f.table)).size).toBeGreaterThan(35);
    // FKs to auth.users: profiles.id plus the legal ledger tables (both cascade)
    expect(fks.filter((f) => f.ref === "auth.users").map((f) => `${f.table}.${f.col}`)).toEqual(["profiles.id", "user_consents.user_id", "user_private.user_id"]);
    // every FK to profiles must be cascade (c) or set null (n): never RESTRICT / NO ACTION (that would block the purge)
    expect(toProfiles.filter((f) => !["c", "n"].includes(f.onDelete)).map((f) => `${f.table}.${f.col}`)).toEqual([]);
  });

  it("seeds one row per (table, column), purges via purge_due_account_deletions, and nothing remains", async () => {
    const fks = await discover();
    const toProfiles = fks.filter((f) => f.ref === "profiles");
    const target = await newUser();
    const other = await newUser();
    const cache = new Map<string, any>();
    const enumFirst = new Map<string, string>();

    const seedRow = async (table: string, fkCol: string | null, depth = 0): Promise<Record<string, any>> => {
      if (depth > 4) throw new Error(`seed recursion too deep at ${table}`);
      const key = `${table}.${fkCol}`;
      if (cache.has(key)) return cache.get(key);
      const cols = await q<any>(
        `select column_name, data_type, udt_name, is_nullable, column_default, is_generated, is_identity
         from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position`, [table]);
      const own = fks.filter((f) => f.table === table);
      const values: Record<string, string> = {};
      for (const c of cols) {
        const name = c.column_name as string;
        if (name === "output_language") continue; // filled by trigger from profiles.locale
        const fk = own.find((f) => f.col === name);
        const required = c.is_nullable === "NO" && c.column_default === null && c.is_generated === "NEVER" && c.is_identity === "NO";
        if (name === fkCol) {
          values[name] = `'${target}'`;
        } else if (fkCol === null && fk?.ref === "profiles") {
          values[name] = `'${target}'`; // parent rows: every owner column (even nullable) belongs to the target
        } else if (table === "reports" && name === "post_id" && fkCol !== "reported_user_id") {
          values[name] = "(select id from public.posts order by created_at limit 1)";
        } else if (!required && !OVERRIDES[table]?.[name]) {
          continue;
        } else if (OVERRIDES[table]?.[name] !== undefined) {
          values[name] = OVERRIDES[table]![name]!.replaceAll("{uid}", target).replaceAll("{other}", other);
        } else if (fk && fk.ref === "profiles") {
          values[name] = `'${fkCol === null ? target : other}'`; // parents are owned by the target; sibling columns by the bystander
        } else if (fk) {
          const parent = await seedRow(fk.ref.replace(/^public\./, ""), null, depth + 1);
          values[name] = `'${parent[fk.refCol]}'`;
        } else if (c.data_type === "USER-DEFINED") {
          if (!enumFirst.has(c.udt_name)) {
            const lbl = await q<any>("select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = $1 order by e.enumsortorder limit 1", [c.udt_name]);
            if (!lbl[0]) throw new Error(`cannot seed ${table}.${name} (${c.udt_name})`);
            enumFirst.set(c.udt_name, lbl[0].enumlabel);
          }
          values[name] = `'${enumFirst.get(c.udt_name)}'::public."${c.udt_name}"`;
        } else if (c.data_type === "uuid") values[name] = "gen_random_uuid()";
        else if (c.data_type === "text" || c.data_type === "character varying") values[name] = "'seedtext1'";
        else if (["integer", "smallint", "bigint", "numeric"].includes(c.data_type)) values[name] = "1";
        else if (c.data_type === "boolean") values[name] = "false";
        else if (c.data_type.startsWith("timestamp")) values[name] = "now()";
        else if (c.data_type === "date") values[name] = "current_date";
        else if (c.data_type === "jsonb") values[name] = "'{}'::jsonb";
        else if (c.data_type === "ARRAY") values[name] = "'{}'";
        else throw new Error(`cannot seed ${table}.${name} (${c.data_type})`);
      }
      const names = Object.keys(values);
      const sql = `insert into public."${table}" (${names.map((x) => `"${x}"`).join(", ")}) values (${names.map((x) => values[x]).join(", ")}) on conflict do nothing returning *`; // triggers may already have created the row (e.g. owner membership)
      let row: Record<string, any>;
      try {
        row = (await q(sql))[0] ?? {};
      } catch (e) {
        throw new Error(`seeding ${table}.${fkCol} failed: ${(e as Error).message}\n${sql}`, { cause: e });
      }
      cache.set(key, row);
      return row;
    };

    // profiles.id is the user itself; account_deletion_requests / ai_spend / ai_budgets need explicit rows below.
    for (const f of toProfiles) await seedRow(f.table.replace(/^public\./, ""), f.col);
    await db.query("insert into public.ai_spend (scope, key, period, period_start, spent_micro_usd) values ('user', $1, 'day', current_date, 5)", [target]);
    await db.query("insert into public.ai_budgets (scope, key, period, hard_limit_micro_usd) values ('user', $1, 'day', 100)", [target]);
    // an audit row that must survive with actor null
    await db.query("insert into public.audit_logs (actor_id, action, entity_type, entity_id) values ($1, 'seed.audit', 'x', 'y')", [target]);

    // positive controls: before the purge every pair really has a row for the target
    const before: Record<string, number> = {};
    for (const f of toProfiles) {
      const t = f.table.replace(/^public\./, "");
      before[`${t}.${f.col}`] = (await q<any>(`select count(*)::int c from public."${t}" where "${f.col}" = $1`, [target]))[0]!.c;
      expect(before[`${t}.${f.col}`], `seed for ${t}.${f.col}`).toBeGreaterThan(0);
    }
    // the bystander has rows too (they must survive)
    const otherBefore = (await q<any>("select count(*)::int c from public.blocks where blocker_id = $1 or blocked_id = $1", [other]))[0]!.c;
    expect(otherBefore).toBeGreaterThan(0);

    // request (as the user) -> not due -> not purged; then make it due and purge as service_role
    await asUser(db, target, (tx) => tx.query("select public.request_account_deletion()"));
    expect((await asService(db, (tx) => tx.query<any>("select public.purge_due_account_deletions() as n"))).rows[0]!.n).toBe(0);
    await db.query("update public.account_deletion_requests set scheduled_for = now() - interval '1 day', requested_at = now() - interval '15 days' where user_id = $1 and status = 'pending'", [target]);
    const purged = (await asService(db, (tx) => tx.query<any>("select public.purge_due_account_deletions(array[$1]::uuid[]) as n", [target]))).rows[0]!.n;
    expect(purged).toBe(1);

    expect(await q("select 1 from auth.users where id = $1", [target])).toEqual([]);
    expect(await q("select 1 from public.profiles where id = $1", [target])).toEqual([]);
    const leftovers: string[] = [];
    for (const f of toProfiles) {
      const t = f.table.replace(/^public\./, "");
      const c = (await q<any>(`select count(*)::int c from public."${t}" where "${f.col}" = $1`, [target]))[0]!.c;
      if (c !== 0) leftovers.push(`${t}.${f.col}=${c}`);
    }
    expect(leftovers).toEqual([]);

    // text-level sweep: the id must not appear in ANY row of ANY public table (catches keys without a FK such as
    // ai_spend.key); the only allowed place is audit_logs with a null actor (the opaque id in entity_id/metadata).
    const tables = await q<any>("select tablename from pg_tables where schemaname = 'public' order by 1");
    const hits: string[] = [];
    for (const { tablename } of tables) {
      if (tablename === "audit_logs") continue;
      const c = (await q<any>(`select count(*)::int c from public."${tablename}" t where t::text ilike '%' || $1 || '%'`, [target]))[0]!.c;
      if (c) hits.push(`${tablename}=${c}`);
    }
    expect(hits).toEqual([]);
    const audits = await q<any>("select actor_id, action from public.audit_logs where actor_id is null and (entity_id = $1 or metadata::text like '%' || $1 || '%')", [target]);
    expect(audits.some((a) => a.action === "account.purged")).toBe(true);
    expect(await q("select 1 from public.audit_logs where actor_id = $1", [target])).toEqual([]);
    expect((await q<any>("select count(*)::int c from public.audit_logs where action = 'seed.audit' and actor_id is null"))[0]!.c).toBe(1);

    // the bystander survived untouched
    expect((await q("select 1 from public.profiles where id = $1", [other])).length).toBe(1);
  }, 120_000);
});

describe("cancelling within the grace period", () => {
  it("cancel keeps the account through and after the scheduled date; the purge ignores it; a later request starts a new 14 days", async () => {
    const u = await newUser();
    await db.query("insert into public.documents (user_id, title, storage_path, idempotency_key) values ($1, 'keep me', $2, $3)", [u, `${u}/k.pdf`, `idem-keep-${u}`]);
    const when = (await asUser(db, u, (tx) => tx.query<any>("select public.request_account_deletion() as t"))).rows[0]!.t as Date;
    expect(when.getTime()).toBeGreaterThan(Date.now() + 13 * 86400000);
    expect((await asUser(db, u, (tx) => tx.query<any>("select public.cancel_account_deletion() as ok"))).rows[0]!.ok).toBe(true);
    // time passes beyond the original schedule
    await db.query("update public.account_deletion_requests set scheduled_for = now() - interval '1 day', requested_at = now() - interval '20 days' where user_id = $1", [u]);
    expect((await asService(db, (tx) => tx.query<any>("select count(*)::int c from public.due_account_deletions()"))).rows[0]!.c).toBe(0);
    expect((await asService(db, (tx) => tx.query<any>("select public.purge_due_account_deletions(array[$1]::uuid[]) as n", [u]))).rows[0]!.n).toBe(0);
    expect((await q("select 1 from public.profiles where id = $1", [u])).length).toBe(1);
    expect((await q("select 1 from public.documents where user_id = $1", [u])).length).toBe(1);
    expect((await q<any>("select status from public.account_deletion_requests where user_id = $1", [u]))[0]!.status).toBe("cancelled");
    const again = (await asUser(db, u, (tx) => tx.query<any>("select public.request_account_deletion() as t"))).rows[0]!.t as Date;
    expect(again.getTime()).toBeGreaterThan(Date.now() + 13 * 86400000);
    // cancelling when nothing is pending reports false (and a stranger cannot cancel somebody else's request)
    const v = await newUser();
    expect((await asUser(db, v, (tx) => tx.query<any>("select public.cancel_account_deletion() as ok"))).rows[0]!.ok).toBe(false);
    expect((await q<any>("select status from public.account_deletion_requests where user_id = $1 and status = 'pending'", [u])).length).toBe(1);
  });
});
