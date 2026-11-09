import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, ids } from "./harness";

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
  await db.query("insert into auth.users (id, email) values ($1, 'alice@example.test')", [ids.alice]);
}, 120_000);
afterAll(async () => {
  await db.close();
});

const pathOfLength = (n: number) => {
  const prefix = `${ids.alice}/`;
  return prefix + "a".repeat(n - prefix.length);
};
const insertDoc = (path: string, key: string) =>
  db.query(
    `insert into public.documents (user_id, title, original_filename, storage_path, mime_type, idempotency_key)
     values ($1, 't', 'a.pdf', $2, 'application/pdf', $3)`,
    [ids.alice, path, key],
  );
const insertResource = (path: string) =>
  db.query("insert into public.resources (uploader_id, title, storage_path) values ($1, 'r', $2)", [ids.alice, path]);

describe("storage_path length (<= 512)", () => {
  it("documents: 512 chars accepted, 513 rejected by the CHECK", async () => {
    await insertDoc(pathOfLength(512), "len-ok-idempotency-key-1");
    await expect(insertDoc(pathOfLength(513), "len-bad-idempotency-key-1")).rejects.toThrow(/documents_storage_path_length/);
  });

  it("resources: 512 chars and NULL accepted, 513 rejected by the CHECK", async () => {
    await insertResource(pathOfLength(512));
    await db.query("insert into public.resources (uploader_id, title) values ($1, 'no file')", [ids.alice]);
    await expect(insertResource(pathOfLength(513))).rejects.toThrow(/resources_storage_path_length/);
  });

  it("documents constraint exists with the length bound", async () => {
    const { rows } = await db.query<{ def: string }>(
      "select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'documents_storage_path_length'",
    );
    expect(rows[0]!.def).toMatch(/char_length\(storage_path\) <= 512/);
  });
});
