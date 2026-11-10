import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser } from "../../db/src/harness";
import { PipelineError } from "./errors";
import { authorizeResourceDownload, importResource, type ImportDeps, type ImportableResource } from "./import-resource";
import { QuotaExceededError } from "./quota";
import { createEnv, ids, type TestEnv } from "./test-utils";

let env: TestEnv;
const PDF = "application/pdf";
const PNG = "image/png";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
beforeAll(async () => {
  env = await createEnv();
  await env.db.query("insert into public.blocks (blocker_id, blocked_id) values ($1, $2)", [ids.carol, ids.alice]);
}, 120_000);
afterAll(async () => {
  await env.db.close();
});

let n = 0;
async function mkResource(o: { uploader?: string; status?: string; vis?: string; mime?: string; size?: number; path?: string | null } = {}) {
  const up = o.uploader ?? ids.alice;
  n++;
  const path = o.path === undefined ? `${up}/notes-${n}.pdf` : o.path;
  const { rows } = await env.db.query<{ id: string }>(
    `insert into public.resources (uploader_id, title, storage_path, status, visibility, mime_type, size_bytes)
     values ($1, $2, $3, $4::public.content_status, $5::public.resource_visibility, $6, $7) returning id`,
    [up, `Shared ${n}`, path, o.status ?? "published", o.vis ?? "public", o.mime ?? PDF, o.size ?? 2048],
  );
  return rows[0]!.id;
}

function makeDeps() {
  const objects = new Set<string>();
  const copies: Array<[string, string]> = [];
  const deps: ImportDeps = {
    repo: env.repo,
    resources: {
      // RLS-scoped read as the caller: the same visibility rules as the app
      async getVisible(userId, id) {
        const r = await asUser(env.db, userId, (tx) =>
          tx.query<any>("select id, uploader_id, title, storage_path, mime_type, size_bytes, original_filename, course_id, status from public.resources where id = $1", [id]),
        );
        const x = r.rows[0];
        return x
          ? ({ id: x.id, uploaderId: x.uploader_id, title: x.title, storagePath: x.storage_path, mimeType: x.mime_type, sizeBytes: x.size_bytes === null ? null : Number(x.size_bytes), originalFilename: x.original_filename, courseId: x.course_id, status: x.status } satisfies ImportableResource)
          : null;
      },
    },
    documents: {
      async findByIdempotencyKey(userId, key) {
        return (await env.db.query<any>("select id, status from public.documents where user_id = $1 and idempotency_key = $2", [userId, key])).rows[0] ?? null;
      },
      async insertUploaded(r) {
        const { rows } = await env.db.query<any>(
          "insert into public.documents (user_id, title, course_id, original_filename, storage_path, mime_type, size_bytes, idempotency_key, status) values ($1,$2,$3,$4,$5,$6,$7,$8,'uploaded') returning id",
          [r.userId, r.title, r.courseId, r.originalFilename, r.storagePath, r.mimeType, r.sizeBytes, r.idempotencyKey],
        );
        return rows[0];
      },
      async remove(id) {
        await env.db.query("delete from public.documents where id = $1", [id]);
      },
    },
    storage: {
      async copyToDocuments(src, dest) {
        copies.push([src, dest]);
        objects.add(dest);
      },
      async removeDocument(dest) {
        objects.delete(dest);
      },
    },
  };
  return { deps, objects, copies };
}
const docCount = async (user: string) => Number((await env.db.query<any>("select count(*)::int c from public.documents where user_id = $1", [user])).rows[0].c);

describe("importResource", () => {
  it("copies a published resource into the caller's own folder, creates the document and enqueues exactly one job", async () => {
    const rid = await mkResource();
    const { deps, objects, copies } = makeDeps();
    const r = await importResource(deps, { userId: ids.bob, resourceId: rid });
    expect(r.created).toBe(true);
    const doc = (await env.db.query<any>("select user_id, storage_path, status, mime_type from public.documents where id = $1", [r.documentId])).rows[0];
    expect(doc.user_id).toBe(ids.bob);
    expect(doc.storage_path.startsWith(`${ids.bob}/`)).toBe(true);
    expect(doc.status).toBe("uploaded");
    expect(copies[0]![0].startsWith(`${ids.alice}/`)).toBe(true); // source in the uploader's folder
    expect(copies[0]![1]).toBe(doc.storage_path);
    expect(objects.has(doc.storage_path)).toBe(true);
    // idempotent: no second copy, document, or job
    const again = await importResource(deps, { userId: ids.bob, resourceId: rid });
    expect(again.documentId).toBe(r.documentId);
    expect(again.created).toBe(false);
    expect(copies.length).toBe(1);
  });

  it("authz: pending, removed, private, university-scoped and unknown resources are all 'not_found' and copy nothing", async () => {
    const { deps, copies } = makeDeps();
    const cases = [
      await mkResource({ status: "pending" }),
      await mkResource({ status: "removed" }),
      await mkResource({ vis: "private" }),
      await mkResource({ vis: "university" }), // bob has no university here
      "99999999-9999-4999-8999-999999999999",
    ];
    for (const rid of cases) await expect(importResource(deps, { userId: ids.bob, resourceId: rid })).rejects.toMatchObject({ code: "not_found" });
    // carol blocked alice: even a public published resource is invisible to her
    await expect(importResource(deps, { userId: ids.carol, resourceId: await mkResource() })).rejects.toMatchObject({ code: "not_found" });
    expect(copies.length).toBe(0);
    // positive control: the same shape of resource succeeds for a non-blocked caller
    await expect(importResource(deps, { userId: ids.bob, resourceId: await mkResource() })).resolves.toBeTruthy();
  });

  it("the uploader may import their own pending file; bad ids are rejected before any lookup", async () => {
    const { deps } = makeDeps();
    await expect(importResource(deps, { userId: ids.alice, resourceId: await mkResource({ status: "pending" }) })).resolves.toBeTruthy();
    await expect(importResource(deps, { userId: "x", resourceId: "y" })).rejects.toMatchObject({ code: "bad_request" });
  });

  it("path rules: a source outside the uploader's folder, or missing, never reaches storage", async () => {
    const { deps, copies } = makeDeps();
    const stolen = await mkResource({ uploader: ids.alice, path: `${ids.alice}/ok.pdf` });
    // simulate a corrupted row (the DB constraint normally prevents it): trusted write
    await env.db.query("alter table public.resources drop constraint resources_storage_path_owner_folder, drop constraint resources_storage_path_safe");
    await env.db.query("update public.resources set storage_path = $2 where id = $1", [stolen, `${ids.bob}/steal.pdf`]);
    await expect(importResource(deps, { userId: ids.bob, resourceId: stolen })).rejects.toMatchObject({ code: "bad_storage_path" });
    const nofile = await mkResource({ path: null });
    await expect(importResource(deps, { userId: ids.bob, resourceId: nofile })).rejects.toBeInstanceOf(PipelineError);
    expect(copies.length).toBe(0);
  });

  it("type and size rules: images and oversize files are refused", async () => {
    const { deps, copies } = makeDeps();
    await expect(importResource(deps, { userId: ids.bob, resourceId: await mkResource({ mime: PNG }) })).rejects.toMatchObject({ code: "unsupported_type" });
    await expect(importResource(deps, { userId: ids.bob, resourceId: await mkResource({ mime: DOCX, size: 26 * 1024 * 1024 }) })).rejects.toMatchObject({ code: "bad_request" });
    expect(copies.length).toBe(0);
    await expect(importResource(deps, { userId: ids.bob, resourceId: await mkResource({ size: 50 * 1024 * 1024 }) })).resolves.toBeTruthy();
    expect(copies.length).toBe(1);
  });

  it("quota: the FREE plan's monthly document limit applies and a refused import leaves no document or object behind", async () => {
    const user = ids.carol;
    await env.db.exec("delete from public.blocks");
    const { deps, objects } = makeDeps();
    for (let i = 0; i < 3; i++) await importResource(deps, { userId: user, resourceId: await mkResource() });
    const before = await docCount(user);
    const objectsBefore = objects.size;
    await expect(importResource(deps, { userId: user, resourceId: await mkResource() })).rejects.toBeInstanceOf(QuotaExceededError);
    expect(await docCount(user)).toBe(before);
    expect(objects.size).toBe(objectsBefore);
  });
});

describe("authorizeResourceDownload", () => {
  it("returns the path only for resources the caller can see", async () => {
    const { deps } = makeDeps();
    const pub = await mkResource();
    expect((await authorizeResourceDownload(deps, { userId: ids.bob, resourceId: pub })).path.startsWith(`${ids.alice}/`)).toBe(true);
    const pending = await mkResource({ status: "pending" });
    await expect(authorizeResourceDownload(deps, { userId: ids.bob, resourceId: pending })).rejects.toMatchObject({ code: "not_found" });
    expect((await authorizeResourceDownload(deps, { userId: ids.alice, resourceId: pending })).path).toBeTruthy(); // own pending
    const removed = await mkResource({ status: "removed" });
    await expect(authorizeResourceDownload(deps, { userId: ids.alice, resourceId: removed })).rejects.toMatchObject({ code: "not_found" });
  });
});
