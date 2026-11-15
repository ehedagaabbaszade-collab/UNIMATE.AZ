import { FakeProvider } from "@unimate/core/src/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { PipelineError } from "./errors";
import { MIME, MemoryStorage, baseDeps, buildDocx, buildPdf, buildPptx, putDoc } from "./fixtures";
import { documentJobRunner, processDocument, submitDocument } from "./process";
import { QuotaExceededError } from "./quota";
import type { OcrEngine } from "./ocr";
import { createEnv, ids, type TestEnv } from "./test-utils";

let env: TestEnv;
const storage = new MemoryStorage();
beforeAll(async () => {
  env = await createEnv();
  // bob is on PLUS (has OCR); alice stays FREE
  await env.db.query("insert into public.subscriptions (user_id, plan, status) values ($1, 'plus', 'active')", [ids.bob]);
}, 120_000);
afterAll(async () => {
  await env.db.close();
});

const AZ = "Əhməd Çingiz ğüşöı İstanbul. Azərbaycan dili: ə ğ ı ö ü ç ş İ.";
const docRow = async (id: string) => (await env.db.query<any>("select status, page_count, error from public.documents where id = $1", [id])).rows[0]!;
const count = async (table: string, id: string) =>
  Number((await env.db.query<any>(`select count(*)::int as n from public.${table} where document_id = $1`, [id])).rows[0].n);
const fakeOcr = (text: string): OcrEngine & { calls: number } => ({
  calls: 0,
  async recognize() {
    this.calls++;
    return text;
  },
});
const run = (deps: ReturnType<typeof baseDeps>, id: string) => processDocument(deps, id);

describe("happy paths", () => {
  it("PDF: pages, chunks with 1536-dim embeddings stored, status ready, blank page reported", async () => {
    const id = await putDoc(env, storage, ids.alice, "lecture.pdf", MIME.pdf, await buildPdf(["Photosynthesis converts light", null, "Mitochondria produce ATP"]));
    const r = await run(baseDeps(env, storage), id);
    expect(r).toMatchObject({ pages: 3, ocrPages: 0, emptyPages: [2] });
    expect(await docRow(id)).toMatchObject({ status: "ready", page_count: 3, error: null });
    const { rows } = await env.db.query<any>("select page_start, page_end, extensions.vector_dims(embedding) as d, metadata from public.document_chunks where document_id = $1 order by chunk_index", [id]);
    expect(rows.map((x) => x.page_start)).toEqual([1, 3]);
    expect(rows.every((x) => x.d === 1536)).toBe(true);
    expect(rows[0].metadata.source_id).toMatch(/^c_/);
    expect(await count("document_pages", id)).toBe(3);
  });

  it("DOCX with Azerbaijani text round-trips through chunks and the database byte-exact (NFC)", async () => {
    const id = await putDoc(env, storage, ids.alice, "az.docx", MIME.docx, await buildDocx([AZ]));
    await run(baseDeps(env, storage), id);
    const { rows } = await env.db.query<any>("select content from public.document_chunks where document_id = $1", [id]);
    expect(rows[0].content).toBe(AZ.normalize("NFC"));
    expect(rows[0].content).toContain("İstanbul");
  });

  it("PPTX: a page per slide", async () => {
    const id = await putDoc(env, storage, ids.alice, "deck.pptx", MIME.pptx, await buildPptx([["Giriş"], ["Nəticə: ş ç ö"]]));
    expect(await run(baseDeps(env, storage), id)).toMatchObject({ pages: 2 });
    const { rows } = await env.db.query<any>("select content from public.document_pages where document_id = $1 order by page_number", [id]);
    expect(rows.map((r) => r.content)).toEqual(["Giriş", "Nəticə: ş ç ö"]);
  });

  it("is idempotent: reprocessing replaces, never duplicates", async () => {
    const id = await putDoc(env, storage, ids.alice, "again.docx", MIME.docx, await buildDocx([AZ]));
    await run(baseDeps(env, storage), id);
    const n = await count("document_chunks", id);
    await run(baseDeps(env, storage), id);
    expect(await count("document_chunks", id)).toBe(n);
    expect(await count("document_pages", id)).toBe(1);
  });

  it("long documents are chunked and embedded in batches", async () => {
    const provider = new (await import("./test-utils")).Dim1536FakeProvider();
    const id = await putDoc(env, storage, ids.alice, "long.docx", MIME.docx, await buildDocx(Array.from({ length: 30 }, (_, i) => `Paragraph ${i} ${"word ".repeat(60)}`)));
    const r = await run(baseDeps(env, storage, { provider, chunk: { maxChars: 300, overlap: 30 }, embedBatchSize: 5 }), id);
    const embedCalls = provider.calls.filter((c) => "inputs" in c);
    expect(r.chunks).toBeGreaterThan(10);
    expect(embedCalls.length).toBe(Math.ceil(r.chunks / 5));
    expect(embedCalls.every((c) => (c as { inputType?: string }).inputType === "passage")).toBe(true); // stored chunks are passages
    const { rows } = await env.db.query<any>("select count(*)::int as n, sum(input_tokens)::int as t from public.ai_usage where feature = 'embed' and user_id = $1", [ids.alice]);
    expect(rows[0].n).toBeGreaterThanOrEqual(embedCalls.length);
  });
});

describe("OCR fallback", () => {
  const scanned = () => buildPdf([null, null]);
  it("scanned PDF on a plan with OCR: engine + rasterizer produce text", async () => {
    const id = await putDoc(env, storage, ids.bob, "scan.pdf", MIME.pdf, await scanned());
    const ocr = fakeOcr("Skan olunmuş mətn: ğ ə");
    const r = await run(baseDeps(env, storage, { ocr, rasterizePdfPage: async () => new Uint8Array([1]) }), id);
    expect(ocr.calls).toBe(2);
    expect(r).toMatchObject({ ocrPages: 2, emptyPages: [] });
    const { rows } = await env.db.query<any>("select content from public.document_chunks where document_id = $1", [id]);
    expect(rows[0].content).toContain("ğ ə");
  });
  it("FREE plan has no OCR: all-blank PDF fails with no_text and the engine is never called", async () => {
    const id = await putDoc(env, storage, ids.alice, "scan2.pdf", MIME.pdf, await scanned());
    const ocr = fakeOcr("x");
    await expect(run(baseDeps(env, storage, { ocr, rasterizePdfPage: async () => new Uint8Array([1]) }), id)).rejects.toMatchObject({ code: "no_text", retryable: false });
    expect(ocr.calls).toBe(0);
  });
  it("no rasterizer: scanned PDF cannot be OCR-ed (documented gap) -> no_text", async () => {
    const id = await putDoc(env, storage, ids.bob, "scan3.pdf", MIME.pdf, await scanned());
    await expect(run(baseDeps(env, storage, { ocr: fakeOcr("x") }), id)).rejects.toMatchObject({ code: "no_text" });
  });
  it("PNG upload goes straight to OCR", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const id = await putDoc(env, storage, ids.bob, "photo.png", MIME.png, png);
    const ocr = fakeOcr("Şəkil mətni");
    expect(await run(baseDeps(env, storage, { ocr }), id)).toMatchObject({ pages: 1, ocrPages: 1 });
  });
  it("mixed PDF: text page kept, blank page OCR-ed", async () => {
    const id = await putDoc(env, storage, ids.bob, "mixed.pdf", MIME.pdf, await buildPdf(["Real text here", null]));
    const ocr = fakeOcr("Scanned page text");
    const r = await run(baseDeps(env, storage, { ocr, rasterizePdfPage: async () => new Uint8Array([1]) }), id);
    expect(ocr.calls).toBe(1);
    expect(r.ocrPages).toBe(1);
  });
});

describe("rejections (all non-retryable and before any embedding spend)", () => {
  const expectReject = async (id: string, code: string, deps = baseDeps(env, storage)) => {
    const provider = deps.provider as FakeProvider;
    const e = await run(deps, id).catch((x) => x);
    expect(e).toBeInstanceOf(PipelineError);
    expect(e).toMatchObject({ code, retryable: false });
    expect(provider.calls).toHaveLength(0);
  };

  it("wrong MIME", async () => expectReject(await putDoc(env, storage, ids.alice, "a.pdf", "text/plain", await buildPdf(["x"])), "mime_mismatch"));
  it("magic bytes do not match extension (zip renamed .pdf)", async () =>
    expectReject(await putDoc(env, storage, ids.alice, "a.pdf", MIME.pdf, await buildDocx(["x"])), "magic_mismatch"));
  it("executable disguised by double extension", async () =>
    expectReject(await putDoc(env, storage, ids.alice, "a.exe.pdf", MIME.pdf, await buildPdf(["x"])), "double_extension"));
  it("oversized by SERVER-read size, even if the DB row claims it is small; body is never read", async () => {
    const s = new MemoryStorage();
    const id = await putDoc(env, s, ids.alice, "big.pdf", MIME.pdf, await buildPdf(["x"]));
    const path = [...s.files.keys()][0]!;
    s.sizeOverride.set(path, 51 * 1024 * 1024);
    await expectReject(id, "too_large", baseDeps(env, s));
    expect(s.reads).toBe(0);
  });
  it("empty file", async () => expectReject(await putDoc(env, storage, ids.alice, "e.pdf", MIME.pdf, new Uint8Array()), "empty_file"));
  it("corrupted PDF", async () =>
    expectReject(await putDoc(env, storage, ids.alice, "c.pdf", MIME.pdf, new TextEncoder().encode("%PDF-1.7\ngarbage garbage")), "corrupt_pdf"));
  it("truncated DOCX", async () => {
    const z = await buildDocx(["hello"]);
    await expectReject(await putDoc(env, storage, ids.alice, "t.docx", MIME.docx, z.slice(0, z.length - 25)), "corrupt_archive");
  });
  it("zip bomb DOCX", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", new Uint8Array(3 * 1024 * 1024));
    const b = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 9 } });
    await expectReject(await putDoc(env, storage, ids.alice, "bomb.docx", MIME.docx, b), "archive_rejected");
  });
  it("blank DOCX has no text", async () => expectReject(await putDoc(env, storage, ids.alice, "b.docx", MIME.docx, await buildDocx(["   "])), "no_text"));
  it("page cap by plan: 31-page PDF on FREE (max 30) -> pages_exceeded", async () => {
    const id = await putDoc(env, storage, ids.alice, "p31.pdf", MIME.pdf, await buildPdf(Array.from({ length: 31 }, (_, i) => `page ${i}`)));
    const e = await run(baseDeps(env, storage), id).catch((x) => x);
    expect(e).toBeInstanceOf(QuotaExceededError);
    expect(e).toMatchObject({ reason: "pages_exceeded", limit: 30 });
  });
  it("embedding with the wrong dimensions (7-dim FakeProvider vs vector(1536)) fails clearly, nothing stored", async () => {
    const id = await putDoc(env, storage, ids.alice, "dims.docx", MIME.docx, await buildDocx([AZ]));
    const e = await run(baseDeps(env, storage, { provider: new FakeProvider() }), id).catch((x) => x);
    expect(e).toMatchObject({ code: "embed_dims", retryable: false });
    expect(await count("document_chunks", id)).toBe(0);
  });
});

describe("job integration", () => {
  it("stuck job that exhausted its attempts: recovery dead-letters it, marks the document failed and releases quota", async () => {
    await env.db.exec("delete from public.processing_jobs");
    const now = new Date("2026-02-20T00:00:00Z");
    const id = await putDoc(env, storage, ids.alice, "stuck.docx", MIME.docx, await buildDocx([AZ]));
    const before = (await env.repo.getUsage(ids.alice, now)).docsThisMonth;
    const { job } = await submitDocument({ repo: env.repo, now: () => now }, { documentId: id, userId: ids.alice });
    expect((await env.repo.getUsage(ids.alice, now)).docsThisMonth).toBe(before + 1);
    await env.db.query("update public.processing_jobs set max_attempts = 1 where id = $1", [job.id]);
    await env.repo.setDocumentStatus(id, "processing");
    expect(await env.repo.claimJob("crashed-worker", now)).not.toBeNull(); // worker dies here
    const runner = documentJobRunner(baseDeps(env, storage, { now: () => now }), "janitor", { staleLockMs: 60_000 });
    expect(await runner.recoverStuck(new Date(now.getTime() + 120_000))).toEqual([job.id]);
    expect((await env.repo.getJob(job.id))!.state).toBe("dead");
    expect(await docRow(id)).toMatchObject({ status: "failed" });
    expect((await docRow(id)).error).toMatch(/lock expired/);
    expect((await env.repo.getUsage(ids.alice, now)).docsThisMonth).toBe(before);
  });

  it("submitDocument is idempotent and consumes the monthly quota exactly once; foreign user is denied", async () => {
    const id = await putDoc(env, storage, ids.alice, "q.docx", MIME.docx, await buildDocx([AZ]));
    const now = new Date("2026-02-10T00:00:00Z");
    const before = (await env.repo.getUsage(ids.alice, now)).docsThisMonth;
    const a = await submitDocument({ repo: env.repo, now: () => now }, { documentId: id, userId: ids.alice });
    const b = await submitDocument({ repo: env.repo, now: () => now }, { documentId: id, userId: ids.alice });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.job.id).toBe(a.job.id);
    expect((await env.repo.getUsage(ids.alice, now)).docsThisMonth).toBe(before + 1);
    await expect(submitDocument({ repo: env.repo, now: () => now }, { documentId: id, userId: ids.bob })).rejects.toMatchObject({ code: "not_found" });
  });

  it("runner: success marks ready; terminal failure marks document failed with a sanitized error and releases quota", async () => {
    await env.db.exec("delete from public.processing_jobs");
    const now = new Date("2026-02-11T00:00:00Z");
    const good = await putDoc(env, storage, ids.bob, "ok.docx", MIME.docx, await buildDocx([AZ]));
    const bad = await putDoc(env, storage, ids.bob, "bad.pdf", MIME.pdf, new TextEncoder().encode("%PDF-1.7\nnope"));
    const deps = baseDeps(env, storage, { now: () => now });
    const before = (await env.repo.getUsage(ids.bob, now)).docsThisMonth;
    await submitDocument({ repo: env.repo, now: () => now }, { documentId: good, userId: ids.bob });
    await submitDocument({ repo: env.repo, now: () => now }, { documentId: bad, userId: ids.bob });
    expect((await env.repo.getUsage(ids.bob, now)).docsThisMonth).toBe(before + 2);
    const runner = documentJobRunner(deps, "worker-1");
    const results = [await runner.runOnce(now), await runner.runOnce(now)];
    expect(results.map((r) => r.status).sort()).toEqual(["failed", "succeeded"]);
    expect(await docRow(good)).toMatchObject({ status: "ready" });
    const badRow = await docRow(bad);
    expect(badRow.status).toBe("failed");
    expect(badRow.error).toMatch(/^corrupt_pdf:/);
    expect(badRow.error).not.toMatch(/\n|at /);
    expect((await env.repo.getUsage(ids.bob, now)).docsThisMonth).toBe(before + 1);
  });

  it("transient provider failure is retried with backoff and then succeeds", async () => {
    await env.db.exec("delete from public.processing_jobs");
    const now = new Date("2026-02-12T00:00:00Z");
    const id = await putDoc(env, storage, ids.alice, "retry.docx", MIME.docx, await buildDocx([AZ]));
    const flaky = new (await import("./test-utils")).Dim1536FakeProvider();
    let fail = true;
    const orig = flaky.embed.bind(flaky);
    flaky.embed = async (r) => {
      if (fail) throw new PipelineError("provider_http", "provider responded 503", true);
      return orig(r);
    };
    await submitDocument({ repo: env.repo, now: () => now }, { documentId: id, userId: ids.alice });
    const runner = documentJobRunner(baseDeps(env, storage, { provider: flaky, now: () => now }), "w2");
    const r1 = await runner.runOnce(now);
    expect(r1.status).toBe("retry_scheduled");
    expect((await docRow(id)).status).toBe("processing");
    fail = false;
    const later = new Date(now.getTime() + 60_000);
    expect((await runner.runOnce(later)).status).toBe("succeeded");
    expect((await docRow(id)).status).toBe("ready");
  });
});

describe("security review hardening", () => {
  const T0 = new Date("2026-09-01T00:00:00Z");

  it("zombie worker: a worker whose lock was recovered cannot write content or flip status", async () => {
    await env.db.exec("delete from public.processing_jobs");
    const id = await putDoc(env, storage, ids.alice, "zombie.docx", MIME.docx, await buildDocx(["zombie content"]));
    const { job } = await submitDocument({ repo: env.repo, now: () => T0 }, { documentId: id, userId: ids.alice });

    // Worker A reads the file; meanwhile the janitor decides A is dead and requeues the job.
    const later = new Date(T0.getTime() + 120_000);
    const hooked = Object.create(storage) as MemoryStorage;
    hooked.read = async (p: string) => {
      expect(await env.repo.recoverStuckJobs(later, 60_000)).toEqual([{ id: job.id, state: "queued" }]);
      return storage.read(p);
    };
    const a = documentJobRunner(baseDeps(env, hooked, { now: () => T0 }), "worker-A");
    expect(await a.runOnce(T0)).toEqual({ status: "lock_lost", jobId: job.id });
    expect(await count("document_chunks", id)).toBe(0);
    expect(await count("document_pages", id)).toBe(0);
    expect((await docRow(id)).status).toBe("processing"); // not ready, not failed

    // Worker B claims the requeued job; A's late write attempt (even after B holds the lock) is rejected.
    const claimed = await env.repo.claimJob("worker-B", later);
    expect(claimed!.id).toBe(job.id);
    await expect(
      processDocument(baseDeps(env, storage), id, { jobId: job.id, workerId: "worker-A" }),
    ).rejects.toMatchObject({ code: "lock_lost" });
    expect(await count("document_chunks", id)).toBe(0);
    await processDocument(baseDeps(env, storage), id, { jobId: job.id, workerId: "worker-B" });
    expect(await count("document_chunks", id)).toBeGreaterThan(0);
    expect((await docRow(id)).status).toBe("ready");
  });

  it("terminal-failure quota release is exactly once (marker in the job payload)", async () => {
    await env.db.exec("delete from public.processing_jobs");
    const now = new Date("2026-09-02T00:00:00Z");
    const bad = await putDoc(env, storage, ids.bob, "bad2.pdf", MIME.pdf, new TextEncoder().encode("%PDF-1.7\nnope"));
    const before = (await env.repo.getUsage(ids.bob, now)).docsThisMonth;
    const { job } = await submitDocument({ repo: env.repo, now: () => now }, { documentId: bad, userId: ids.bob });
    expect((await env.repo.getUsage(ids.bob, now)).docsThisMonth).toBe(before + 1);
    const runner = documentJobRunner(baseDeps(env, storage, { now: () => now }), "w-rel");
    expect((await runner.runOnce(now)).status).toBe("failed");
    expect((await env.repo.getUsage(ids.bob, now)).docsThisMonth).toBe(before);
    expect((await env.repo.getJob(job.id))!.payload).toMatchObject({ quotaReleased: true });
    // a second terminal hook for the same job (e.g. janitor + runner race) must not release again
    expect(await env.repo.releaseJobUsage(job, "upload_doc", "2026-09-01")).toBe(false);
    const other = await putDoc(env, storage, ids.bob, "other.docx", MIME.docx, await buildDocx(["x"]));
    await submitDocument({ repo: env.repo, now: () => now }, { documentId: other, userId: ids.bob });
    expect(await env.repo.releaseJobUsage(job, "upload_doc", "2026-09-01")).toBe(false);
    expect((await env.repo.getUsage(ids.bob, now)).docsThisMonth).toBe(before + 1); // other doc's unit untouched
  });

  it("plan page cap rejects an oversized PPTX/PDF before any content is stored", async () => {
    const pptx = await putDoc(env, storage, ids.alice, "big.pptx", MIME.pptx, await buildPptx(Array.from({ length: 31 }, (_, i) => [`s${i}`])));
    await expect(run(baseDeps(env, storage), pptx)).rejects.toMatchObject({ code: "quota_exceeded" });
    expect(await count("document_pages", pptx)).toBe(0);
    const pdf = await putDoc(env, storage, ids.alice, "big.pdf", MIME.pdf, await buildPdf(Array.from({ length: 31 }, (_, i) => `p${i}`)));
    await expect(run(baseDeps(env, storage), pdf)).rejects.toMatchObject({ code: "quota_exceeded" });
    expect(await count("document_pages", pdf)).toBe(0);
  });

  it("storage path is asserted before any storage access", async () => {
    const id = await putDoc(env, storage, ids.alice, "path.docx", MIME.docx, await buildDocx(["x"]));
    const real = (await env.repo.getDocument(id))!;
    const repo = Object.create(env.repo);
    const forged = `${ids.bob}/x.docx`; // another owner's folder
    for (const storagePath of [forged, `${ids.alice}/../${ids.bob}/x.docx`, `${ids.alice}/sub/x.docx`, "x.docx"]) {
      repo.getDocument = async () => ({ ...real, storagePath });
      const touched: string[] = [];
      const spy = new Proxy(storage, { get: (t, k) => (typeof k === "string" && ["size", "readHead", "read"].includes(k) ? (...a: any[]) => (touched.push(k), (t as any)[k](...a)) : (t as any)[k]) });
      await expect(processDocument(baseDeps(env, spy as MemoryStorage, { repo }), id)).rejects.toMatchObject({ code: "bad_storage_path", retryable: false });
      expect(touched).toEqual([]);
    }
  });
});
