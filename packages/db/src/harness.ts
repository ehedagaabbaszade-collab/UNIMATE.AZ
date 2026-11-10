import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";

const supabaseDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../supabase");

/**
 * Minimal stand-ins for what Supabase provides before user migrations run:
 * roles, auth.users + auth.uid(), a tiny storage schema, and default grants on public.
 */
const SUPABASE_STUBS = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema extensions;
create schema auth;
create schema storage;
grant usage on schema public, auth, extensions, storage to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- nullif: once a custom GUC was set in a session it reads back as '' (not NULL) after the txn ends.
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user)
$$;

create table storage.buckets (
  id text primary key,
  name text not null unique,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null,
  owner uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end $$;
grant all on all tables in schema storage to anon, authenticated, service_role;
grant execute on all functions in schema storage to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant select on auth.users to service_role;

-- Same default privileges Supabase gives the API roles on public.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

export type Role = "anon" | "authenticated" | "service_role";

export function migrationFiles(): string[] {
  return readdirSync(path.join(supabaseDir, "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export async function createTestDb(opts: { seed?: boolean } = {}): Promise<PGlite> {
  const db = new PGlite({ extensions: { vector } });
  await db.waitReady;
  await db.exec(SUPABASE_STUBS);
  for (const file of migrationFiles()) {
    const sql = readFileSync(path.join(supabaseDir, "migrations", file), "utf8");
    try {
      await db.exec(sql);
    } catch (e) {
      throw new Error(`migration ${file} failed: ${(e as Error).message}`, { cause: e });
    }
  }
  if (opts.seed) {
    await db.exec(readFileSync(path.join(supabaseDir, "seed.sql"), "utf8"));
  }
  return db;
}

/** Run fn inside a transaction as an API role. RLS applies (the connection itself is superuser). */
export async function asRole<T>(
  db: PGlite,
  role: Role,
  uid: string | null,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [uid ?? ""]);
    return fn(tx);
  });
}

export const asUser = <T>(db: PGlite, uid: string | null, fn: (tx: Transaction) => Promise<T>) =>
  asRole(db, "authenticated", uid, fn);
/** The JWT identity is `uid` but the statement runs with the connection's owner privileges: the path SECURITY DEFINER wrappers take. */
export const asOwnerAs = <T>(db: PGlite, uid: string, fn: (tx: Transaction) => Promise<T>) =>
  db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
    return fn(tx);
  });
export const asAnon = <T>(db: PGlite, fn: (tx: Transaction) => Promise<T>) => asRole(db, "anon", null, fn);
export const asService = <T>(db: PGlite, fn: (tx: Transaction) => Promise<T>) => asRole(db, "service_role", null, fn);

const isPermissionDenied = (e: unknown) => (e as { code?: string }).code === "42501";

/** Rows visible to the role. "permission denied" counts as seeing nothing. */
export async function select(
  db: PGlite,
  role: Role,
  uid: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<Record<string, unknown>[]> {
  try {
    return await asRole(db, role, uid, async (tx) => (await tx.query<Record<string, unknown>>(sql, params)).rows);
  } catch (e) {
    if (isPermissionDenied(e)) return [];
    throw e;
  }
}

/** Rows affected by a write. Privilege errors (42501 permission denied) count as 0 rows. */
export async function affected(
  db: PGlite,
  role: Role,
  uid: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<number> {
  try {
    return await asRole(db, role, uid, async (tx) => (await tx.query(sql, params)).affectedRows ?? 0);
  } catch (e) {
    if (isPermissionDenied(e) && /permission denied/i.test((e as Error).message)) return 0;
    throw e;
  }
}

export const vec = (hot: number, dims = 1536): string =>
  `[${Array.from({ length: dims }, (_, i) => (i === hot ? 1 : 0)).join(",")}]`;

export const ids = {
  alice: "00000000-0000-4000-8000-00000000000a",
  bob: "00000000-0000-4000-8000-00000000000b",
  carol: "00000000-0000-4000-8000-00000000000c",
  mod: "00000000-0000-4000-8000-0000000000d1",
  admin: "00000000-0000-4000-8000-0000000000d2",
  superAdmin: "00000000-0000-4000-8000-0000000000d3",
  docA: "10000000-0000-4000-8000-00000000000a",
  docB: "10000000-0000-4000-8000-00000000000b",
  chunkA0: "20000000-0000-4000-8000-0000000000a0",
  chunkA1: "20000000-0000-4000-8000-0000000000a1",
  chunkB0: "20000000-0000-4000-8000-0000000000b0",
  convA: "30000000-0000-4000-8000-00000000000a",
  convB: "30000000-0000-4000-8000-00000000000b",
  msgA: "40000000-0000-4000-8000-00000000000a",
  msgB: "40000000-0000-4000-8000-00000000000b",
  usageA: "50000000-0000-4000-8000-00000000000a",
  usageB: "50000000-0000-4000-8000-00000000000b",
  pubCommunity: "60000000-0000-4000-8000-000000000001",
  privCommunity: "60000000-0000-4000-8000-000000000002",
  pubPost: "70000000-0000-4000-8000-000000000001",
  privPost: "70000000-0000-4000-8000-000000000002",
} as const;

/** Users alice/bob/carol (students), mod, admin, super_admin; documents, chunks, chats, communities, posts. */
export async function seedFixtures(db: PGlite): Promise<void> {
  const users: [string, string][] = [
    [ids.alice, "alice"],
    [ids.bob, "bob"],
    [ids.carol, "carol"],
    [ids.mod, "mod"],
    [ids.admin, "admin"],
    [ids.superAdmin, "superadmin"],
  ];
  for (const [id, name] of users) {
    await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [
      id,
      `${name}@example.test`,
      JSON.stringify({ display_name: name }),
    ]);
  }
  await db.query("update public.profiles set role = 'moderator' where id = $1", [ids.mod]);
  await db.query("update public.profiles set role = 'admin' where id = $1", [ids.admin]);
  await db.query("update public.profiles set role = 'super_admin' where id = $1", [ids.superAdmin]);

  await db.query(
    `insert into public.documents (id, user_id, title, storage_path, idempotency_key) values
       ($1, $2, 'Alice doc', $5, 'idem-alice-1'),
       ($3, $4, 'Bob doc', $6, 'idem-bob-0001')`,
    [ids.docA, ids.alice, ids.docB, ids.bob, `${ids.alice}/a.pdf`, `${ids.bob}/b.pdf`],
  );
  await db.query(
    `insert into public.document_chunks (id, document_id, chunk_index, content, embedding) values
       ($1, $4, 0, 'alice chunk zero', $6), ($2, $4, 1, 'alice chunk one', $7), ($3, $5, 0, 'bob chunk zero', $6)`,
    [ids.chunkA0, ids.chunkA1, ids.chunkB0, ids.docA, ids.docB, vec(0), vec(1)],
  );
  await db.query(
    `insert into public.conversations (id, user_id, document_id) values ($1, $2, $3), ($4, $5, $6)`,
    [ids.convA, ids.alice, ids.docA, ids.convB, ids.bob, ids.docB],
  );
  await db.query(
    `insert into public.messages (id, conversation_id, role, content, citations) values
       ($1, $3, 'user', 'alice secret question', '[{"page":1}]'), ($2, $4, 'user', 'bob secret question', '[]')`,
    [ids.msgA, ids.msgB, ids.convA, ids.convB],
  );
  await db.query(
    `insert into public.ai_usage (id, user_id, feature, input_tokens) values ($1, $2, 'chat', 10), ($3, $4, 'chat', 20)`,
    [ids.usageA, ids.alice, ids.usageB, ids.bob],
  );
  await db.query(
    `insert into public.communities (id, name, slug, visibility, created_by) values
       ($1, 'Public', 'public-c', 'public', $3), ($2, 'Private', 'private-c', 'private', $3)`,
    [ids.pubCommunity, ids.privCommunity, ids.alice],
  );
  // alice became owner of both through the trigger; carol joins both, bob joins neither.
  await db.query(
    `insert into public.memberships (community_id, user_id) values ($1, $3), ($2, $3)`,
    [ids.pubCommunity, ids.privCommunity, ids.carol],
  );
  await db.query(
    `insert into public.posts (id, community_id, author_id, title, body) values
       ($1, $3, $5, 'public post', 'hello'), ($2, $4, $5, 'private post', 'members only')`,
    [ids.pubPost, ids.privPost, ids.pubCommunity, ids.privCommunity, ids.alice],
  );
}
