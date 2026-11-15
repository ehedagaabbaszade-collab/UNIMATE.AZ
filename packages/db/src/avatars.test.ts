import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb } from "./harness";

// Migration 20260101005200 (avatars bucket). Client checks run as `authenticated` with auth.uid() set; every negative
// result has a positive control.

let db: PGlite;
const A = "00000000-0000-4000-8000-00000000a001";
const B = "00000000-0000-4000-8000-00000000a002";
const raw = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows;
const run = (uid: string, sql: string, params: unknown[] = []) => asUser(db, uid, (tx) => tx.query<Record<string, any>>(sql, params));
const fails = async (uid: string, sql: string, params: unknown[] = []) => {
  let err: Error | null = null;
  try {
    await run(uid, sql, params);
  } catch (e) {
    err = e as Error;
  }
  expect(err, `expected failure: ${sql}`).not.toBeNull();
};

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.close();
});

describe("avatars bucket", () => {
  it("is public-read, small, images only", async () => {
    const b = (await raw("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'avatars'"))[0]!;
    expect(b.public).toBe(true);
    expect(Number(b.file_size_limit)).toBe(2 * 1024 * 1024);
    expect([...b.allowed_mime_types].sort()).toEqual(["image/jpeg", "image/png", "image/webp"]);
  });

  it("owner can write, list, replace and delete only inside their own uid folder", async () => {
    await run(A, "insert into storage.objects (bucket_id, name, owner) values ('avatars', $1, $2)", [`${A}/a.jpg`, A]);
    await fails(A, "insert into storage.objects (bucket_id, name, owner) values ('avatars', $1, $2)", [`${B}/x.jpg`, A]);
    await fails(A, "insert into storage.objects (bucket_id, name, owner) values ('avatars', $1, $2)", ["a.jpg", A]);
    // listing: own files visible, other users' files are not enumerable
    await run(B, "insert into storage.objects (bucket_id, name, owner) values ('avatars', $1, $2)", [`${B}/b.jpg`, B]);
    expect((await run(A, "select name from storage.objects where bucket_id = 'avatars'")).rows.map((r) => r.name)).toEqual([`${A}/a.jpg`]);
    // update policy: renaming an own file into someone else's folder is rejected
    await fails(A, "update storage.objects set name = $1 where bucket_id = 'avatars' and name = $2", [`${B}/a.jpg`, `${A}/a.jpg`]);
    expect((await raw("select 1 from storage.objects where name = $1", [`${A}/a.jpg`])).length).toBe(1);
    // delete of someone else's file affects nothing; own file works
    await run(A, "delete from storage.objects where bucket_id = 'avatars' and name = $1", [`${B}/b.jpg`]);
    expect((await raw("select 1 from storage.objects where name = $1", [`${B}/b.jpg`])).length).toBe(1);
    await run(A, "delete from storage.objects where bucket_id = 'avatars' and name = $1", [`${A}/a.jpg`]);
    expect((await raw("select 1 from storage.objects where name = $1", [`${A}/a.jpg`])).length).toBe(0);
  });

  it("does not open any other bucket", async () => {
    const pol = await raw("select policyname, cmd from pg_policies where schemaname = 'storage' and policyname like 'avatars_bucket_%'");
    expect(pol.map((p) => p.cmd).sort()).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
    await fails(A, "insert into storage.objects (bucket_id, name, owner) values ('documents', $1, $2)", [`${B}/d.pdf`, A]);
  });
});
