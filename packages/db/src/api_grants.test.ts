import type { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { createTestDb } from "./harness";

// Newer hosted Supabase projects give anon/authenticated/service_role NO default grants on public. Migration
// 20260101004900_explicit_api_grants.sql must produce the same final privilege matrix as the classic default-grant
// project the rest of the suite runs on. Reference = harness with default grants WITHOUT that migration.
// MAINTAIN (PG17+ only) is ignored: PGlite is PG18, the target is PG15.

const MIG = "20260101004900_explicit_api_grants.sql";

async function matrix(db: PGlite): Promise<string[]> {
  const rows: string[] = [];
  const q = async (sql: string) => (await db.query<{ k: string }>(sql)).rows.map((r) => r.k);
  rows.push(
    ...(await q(`
    select format('rel %s %s %s %s', c.relkind, c.relname, coalesce(r.rolname,'PUBLIC'), a.privilege_type) k
    from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl, acldefault((case when c.relkind='S' then 'S' else 'r' end)::"char", c.relowner))) a
    left join pg_roles r on r.oid = a.grantee
    where c.relnamespace='public'::regnamespace and c.relkind in ('r','p','v','m','f','S')
      and (a.grantee=0 or r.rolname in ('anon','authenticated','service_role')) and a.privilege_type <> 'MAINTAIN'`)),
    ...(await q(`
    select format('col %s.%s %s %s', c.relname, at.attname, coalesce(r.rolname,'PUBLIC'), a.privilege_type) k
    from pg_attribute at join pg_class c on c.oid=at.attrelid
    cross join lateral aclexplode(at.attacl) a
    left join pg_roles r on r.oid = a.grantee
    where c.relnamespace='public'::regnamespace and at.attacl is not null
      and (a.grantee=0 or r.rolname in ('anon','authenticated','service_role'))`)),
    ...(await q(`
    select format('fn %s(%s) %s', p.proname, pg_get_function_identity_arguments(p.oid), coalesce(r.rolname,'PUBLIC')) k
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) a
    left join pg_roles r on r.oid = a.grantee
    where p.pronamespace='public'::regnamespace and a.privilege_type='EXECUTE'
      and (a.grantee=0 or r.rolname in ('anon','authenticated','service_role'))`)),
    ...(await q(`
    select format('schema %s %s', coalesce(r.rolname,'PUBLIC'), a.privilege_type) k
    from pg_namespace n cross join lateral aclexplode(n.nspacl) a left join pg_roles r on r.oid=a.grantee
    where n.nspname='public' and (a.grantee=0 or r.rolname in ('anon','authenticated','service_role'))`)),
  );
  return rows.sort();
}

describe("explicit API grants", () => {
  it("a project without default grants ends with the same privilege matrix as the classic default-grant project", async () => {
    const reference = await createTestDb({ excludeMigrations: [MIG] });
    const bare = await createTestDb({ defaultGrants: false });
    const [ref, got] = await Promise.all([matrix(reference), matrix(bare)]);
    expect(ref.length).toBeGreaterThan(300); // positive control
    expect(got.filter((r) => !ref.includes(r))).toEqual([]);
    expect(ref.filter((r) => !got.includes(r))).toEqual([]);
  }, 180000);

  it("without the migration a bare project has no API grants (the bug), and the app-level reads work with it", async () => {
    const broken = await createTestDb({ defaultGrants: false, excludeMigrations: [MIG] });
    const ok = await createTestDb({ defaultGrants: false });
    const priv = async (db: PGlite) =>
      (await db.query<{ a: boolean; b: boolean; c: boolean }>(
        `select has_table_privilege('authenticated','public.universities','select') a,
                has_table_privilege('anon','public.audit_logs','insert') b,
                has_table_privilege('authenticated','public.audit_logs','update') c`,
      )).rows[0]!;
    expect((await priv(broken)).a).toBe(false);
    expect(await priv(ok)).toEqual({ a: true, b: false, c: false });
  }, 180000);
});
