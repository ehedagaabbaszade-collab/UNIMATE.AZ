import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb } from "./harness";

// Migration 20260101004510 (notes hardening). Client-side checks run as `authenticated`; every negative has a positive control.

let db: PGlite;
const uni = "a0000000-0000-4000-8000-000000000001";
const U = (k: number) => `00000000-0000-4000-8000-00000000d${String(k).padStart(3, "0")}`;
const [UP, ST, MOD, FLOODER] = [U(1), U(2), U(3), U(4)];
const PDF = "application/pdf";
const PNG = "image/png";

const raw = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows;
const run = (uid: string, sql: string, params: unknown[] = []) => asUser(db, uid, (tx) => tx.query<Record<string, any>>(sql, params));
const rows = async (uid: string, sql: string, params: unknown[] = []) => (await run(uid, sql, params)).rows;
const failsWith = async (uid: string, sql: string, params: unknown[], re: RegExp) => {
  let err: Error | null = null;
  try {
    await run(uid, sql, params);
  } catch (e) {
    err = e as Error;
  }
  expect(err, `expected failure: ${sql}`).not.toBeNull();
  expect(err!.message).toMatch(re);
};

let n = 0;
const putObject = async (owner: string, o: { size?: number; mime?: string; etag?: string } = {}) => {
  const path = `${owner}/obj${++n}.pdf`;
  await raw("insert into storage.objects (bucket_id, name, owner, metadata) values ('resources', $1, $2, $3)", [
    path, owner, JSON.stringify({ size: o.size ?? 2048, mimetype: o.mime ?? PDF, eTag: `"${o.etag ?? `etag-${n}`}"` }),
  ]);
  return path;
};
const create = async (owner: string, path: string, mime = PDF, size = 2048) =>
  (await rows(owner, "select public.create_resource('Notes', null, 'note', null, 'public', '{}', $1, $2, $3, 'f.pdf') as id", [path, mime, size]))[0]!.id as string;
const publish = (id: string) => rows(MOD, "select public.admin_review_content('resource', $1, 'approve', 'fine')", [id]);

beforeAll(async () => {
  db = await createTestDb({ seed: false });
  for (const [i, u] of [UP, ST, MOD, FLOODER].entries())
    await raw("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [u, `nh${i}@example.test`, JSON.stringify({ display_name: `U${i}` })]);
  await raw("insert into public.universities (id, name) values ($1, 'Hardening University')", [uni]);
  await raw("update public.profiles set university_id = $1", [uni]);
  await raw("update public.profiles set role = 'moderator' where id = $1", [MOD]);
}, 120_000);
afterAll(async () => {
  await db.close();
});

describe("storage object binding", () => {
  it("create_resource binds the object (id, etag, size) and rejects a mime or size that differs from storage metadata", async () => {
    const path = await putObject(UP, { size: 2048, etag: "abc" });
    await failsWith(UP, "select public.create_resource('t', null, 'note', null, 'public', '{}', $1, $2, 2048, 'f')", [path, PNG], /does not match/);
    await failsWith(UP, "select public.create_resource('t', null, 'note', null, 'public', '{}', $1, $2, 999, 'f')", [path, PDF], /does not match/);
    expect(await raw("select 1 from public.resources where storage_path = $1", [path])).toEqual([]);
    const id = await create(UP, path); // control: matching declaration works
    const r = (await raw("select r.storage_object_id, r.storage_etag, r.storage_size, o.id as oid from public.resources r join storage.objects o on o.name = r.storage_path where r.id = $1", [id]))[0]!;
    expect(r).toMatchObject({ storage_etag: "abc" });
    expect(Number(r.storage_size)).toBe(2048);
    expect(r.storage_object_id).toBe(r.oid);
    // an object without usable metadata is not an upload
    await raw("insert into storage.objects (bucket_id, name, owner) values ('resources', $1, $2)", [`${UP}/nometa.pdf`, UP]);
    await failsWith(UP, "select public.create_resource('t', null, 'note', null, 'public', '{}', $1, $2, 1, 'f')", [`${UP}/nometa.pdf`, PDF], /not been uploaded/);
  });

  it("direct INSERT is bound too: foreign folder, missing object and wrong mime are refused; binding columns cannot be forged or changed", async () => {
    const ins = (uid: string, path: string, mime: string | null = null, extra = "") =>
      run(uid, `insert into public.resources (uploader_id, title, storage_path, mime_type ${extra ? ", storage_etag" : ""}) values ($1, 'direct', $2, $3 ${extra ? ", 'forged'" : ""}) returning id`, [uid, path, mime]);
    const mine = await putObject(UP, { etag: "real" });
    await failsWith(UP, "insert into public.resources (uploader_id, title, storage_path) values ($1, 'x', $2)", [UP, await putObject(ST)], /invalid storage path/);
    await failsWith(UP, "insert into public.resources (uploader_id, title, storage_path) values ($1, 'x', $2)", [UP, `${UP}/ghost.pdf`], /not been uploaded/);
    await failsWith(UP, "insert into public.resources (uploader_id, title, storage_path, mime_type) values ($1, 'x', $2, $3)", [UP, mine, PNG], /does not match/);
    const id = (await ins(UP, mine, null, "forge")).rows[0]!.id;
    const r = (await raw("select storage_etag, mime_type, size_bytes, storage_object_id is not null as bound from public.resources where id = $1", [id]))[0]!;
    expect(r).toMatchObject({ storage_etag: "real", mime_type: PDF, bound: true }); // forged etag overwritten, mime filled from the object
    // pinned on update: repointing at another object (or a different size) is silently ignored
    const other = await putObject(UP);
    await run(UP, "update public.resources set storage_path = $2, size_bytes = 1, storage_etag = 'x', title = 'renamed' where id = $1", [id, other]);
    const after = (await raw("select storage_path, size_bytes, storage_etag, title from public.resources where id = $1", [id]))[0]!;
    expect(after).toMatchObject({ storage_path: mine, storage_etag: "real", title: "renamed" });
    expect(Number(after.size_bytes)).toBe(2048);
  });

  it("owner cannot overwrite or delete the object behind a pending/published resource; unlinked objects and removed resources stay manageable", async () => {
    const path = await putObject(UP);
    const free = await putObject(UP);
    const id = await create(UP, path);
    const del = async (p: string) => (await run(UP, "delete from storage.objects where name = $1", [p])).affectedRows ?? 0;
    const upd = async (p: string) => (await run(UP, "update storage.objects set metadata = '{\"size\":1,\"mimetype\":\"application/pdf\"}' where name = $1", [p])).affectedRows ?? 0;
    // The bucket has no client SELECT policy, which would make UPDATE/DELETE match nothing at all; grant a temporary owner
    // read policy so the UPDATE/DELETE policies under test are what decides. Positive control first: an unlinked object works.
    await raw("create policy tmp_owner_read on storage.objects for select to authenticated using (bucket_id = 'resources' and (storage.foldername(name))[1] = (select auth.uid())::text)");
    expect(await upd(free)).toBe(1);
    expect(await del(free)).toBe(1);
    expect(await upd(path)).toBe(0); // pending
    expect(await del(path)).toBe(0);
    await publish(id);
    expect(await upd(path)).toBe(0); // published
    expect(await del(path)).toBe(0);
    expect((await raw("select metadata->>'size' as s from storage.objects where name = $1", [path]))[0]!.s).toBe("2048");
    // another user's folder is never reachable (control for the folder condition)
    expect((await run(ST, "delete from storage.objects where name = $1", [path])).affectedRows ?? 0).toBe(0);
    // once the resource is removed by a moderator the owner may clean up
    await raw("update public.resources set status = 'removed' where id = $1", [id]);
    expect(await del(path)).toBe(1);
    await raw("drop policy tmp_owner_read on storage.objects");
  });
});

describe("takedown_requests", () => {
  it("one account cannot hide many resources through direct inserts (10/day, positive control below the cap)", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const id = await create(UP, await putObject(UP));
      await publish(id);
      ids.push(id);
    }
    // keep the uploader under the 20/day upload cap
    const td = (res: string) => run(FLOODER, "insert into public.takedown_requests (resource_id, requester_id, reason) values ($1, $2, 'this infringes copyright badly')", [res, FLOODER]);
    for (const id of ids.slice(0, 10)) await td(id);
    await failsWith(FLOODER, "insert into public.takedown_requests (resource_id, requester_id, reason) values ($1, $2, 'this infringes copyright badly')", [ids[10], FLOODER], /too many reports/);
    expect((await raw("select count(*)::int as n from public.resources where id = any($1) and status = 'pending' and takedown_hold", [ids]))[0]!.n).toBe(10);
    expect((await raw("select status from public.resources where id = $1", [ids[10]]))[0]!.status).toBe("published"); // the 11th stayed visible
    // the RPC path keeps its own identical cap
    await failsWith(FLOODER, "select public.report_copyright($1, 'copied without permission, see the book')", [ids[11]], /too many reports|resource not found/);
    // control: a different account can still report
    await rows(ST, "select public.report_copyright($1, 'copied without permission, see the book')", [ids[11]]);
  });
});

describe("resource_meta", () => {
  it("returns uploader/status only for resources the caller may see", async () => {
    const id = await create(UP, await putObject(UP)); // pending
    const meta = (uid: string) => rows(uid, "select * from public.resource_meta($1)", [id]);
    expect(await meta(UP)).toEqual([{ uploader: UP, status: "pending" }]); // own pending
    expect(await meta(MOD)).toHaveLength(1);
    expect(await meta(ST)).toEqual([{ uploader: null, status: null }]); // invisible: no existence/uploader oracle
    await publish(id);
    expect(await meta(ST)).toEqual([{ uploader: UP, status: "published" }]); // control: visible once published
  });
});
