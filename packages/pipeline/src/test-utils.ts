import type { PGlite } from "@electric-sql/pglite";
import { FakeProvider } from "@unimate/core/src/testing";
import type { EmbedRequest, EmbedResult, GenerateRequest } from "@unimate/core";
import { createTestDb, ids } from "../../db/src/harness";
import { pgliteRepository } from "./pglite-repository";
import type { SqlRepository } from "./sql-repository";

export { ids };
export const EMBED_DIMS = 1536;

export interface TestEnv {
  db: PGlite;
  repo: SqlRepository;
}
export async function createEnv(): Promise<TestEnv> {
  const db = await createTestDb();
  for (const [id, name] of [
    [ids.alice, "alice"],
    [ids.bob, "bob"],
    [ids.carol, "carol"],
  ] as const)
    await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${name}@example.test`]);
  return { db, repo: pgliteRepository(db) };
}

let docSeq = 0;
export async function insertDoc(
  db: PGlite,
  userId: string,
  o: { filename?: string; mime?: string; status?: string } = {},
): Promise<string> {
  const n = ++docSeq;
  const filename = o.filename ?? "notes.pdf";
  const { rows } = await db.query<{ id: string }>(
    `insert into public.documents (user_id, title, original_filename, storage_path, mime_type, idempotency_key, status)
     values ($1, 'Test doc', $2, $3, $4, $5, $6::public.doc_status) returning id`,
    [userId, filename, `${userId}/doc-${n}-${filename}`, o.mime ?? "application/pdf", `idem-key-${n}-${Math.random()}`, o.status ?? "uploaded"],
  );
  return rows[0]!.id;
}

/**
 * FakeProvider produces 7-dim vectors but document_chunks.embedding is vector(1536).
 * This wrapper spreads the fake vector deterministically over 1536 dims. Only for tests.
 */
export class Dim1536FakeProvider extends FakeProvider {
  override async embed(req: EmbedRequest): Promise<EmbedResult> {
    const r = await super.embed(req);
    return { ...r, vectors: r.vectors.map((v) => Array.from({ length: EMBED_DIMS }, (_, i) => v[i % v.length]! + (i % 11) * 1e-3)) };
  }
}

export const generateCalls = (p: FakeProvider): GenerateRequest[] =>
  p.calls.filter((c): c is GenerateRequest => "prompt" in c);
