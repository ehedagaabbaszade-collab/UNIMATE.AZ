import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PipelineError } from "./errors";
import { extractDocx } from "./extract/office";
import { readCentralDirectory } from "./extract/zip";
import { MIME, MemoryStorage, baseDeps, buildDocx, putDoc, readyDocFromText } from "./fixtures";
import { generateSummary } from "./generate";
import { JobRunner } from "./jobs";
import { documentJobRunner, processDocument, submitDocument } from "./process";
import { ProviderHttpError, postJson } from "./providers/http";
import { askDocument } from "./rag";
import { Dim1536FakeProvider, createEnv, ids, insertDoc, type TestEnv } from "./test-utils";

let env: TestEnv;
const storage = new MemoryStorage();
const models = { small: "m-small", standard: "m-standard", premium: "m-premium", embed: "m-embed" };
let docA: string;
beforeAll(async () => {
  env = await createEnv();
  await env.db.query("insert into public.subscriptions (user_id, plan, status) values ($1, 'pro', 'active')", [ids.bob]);
  docA = await readyDocFromText(env, ids.alice, ["Mitoxondri hüceyrənin enerji stansiyasıdır."]);
}, 120_000);
afterAll(async () => {
  await env.db.close();
});

describe("office regex (no quadratic backtracking)", () => {
  const wrap = (body: string) => new TextEncoder().encode(body);
  it("400KB of repeated '<w:t ' extracts quickly", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", `<w:document><w:p>${"<w:t ".repeat(80_000)}</w:p></w:document>`);
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
    const t0 = Date.now();
    await extractDocx(bytes);
    expect(Date.now() - t0).toBeLessThan(1000);
    void wrap;
  });
  it("normal input is unchanged", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      '<w:document><w:p><w:r><w:t>a</w:t></w:r><w:r><w:t xml:space="preserve"> b &amp; c</w:t></w:r></w:p><w:p><w:t >x</w:t><w:tab/><w:t>y</w:t></w:p></w:document>',
    );
    const [p] = await extractDocx(await zip.generateAsync({ type: "uint8array" }));
    expect(p!.text).toBe("a b & c\nx\ty\n");
  });
});

describe("billable provider failures are not refunded", () => {
  const T = new Date("2026-10-01T09:00:00Z");
  const used = async (u = ids.alice) => (await env.repo.getUsage(u, T)).aiMessagesToday;
  const failing = (err: Error) => {
    const p = new Dim1536FakeProvider();
    p.generate = async () => {
      throw err;
    };
    return p;
  };
  const ask = (p: Dim1536FakeProvider) => askDocument({ repo: env.repo, provider: p, models, now: () => T }, { userId: ids.alice, documentId: docA, question: "Salam?" });

  it("postJson flags timeout / invalid JSON / 5xx / 429 billable; network error and 400 are not", async () => {
    const run = (f: (...a: any[]) => Promise<Response>) => postJson("p", f as never, "http://x", {}, {}, 50).catch((e) => e as PipelineError);
    const t = new Error("t");
    t.name = "TimeoutError";
    expect(await run(async () => Promise.reject(t))).toMatchObject({ code: "provider_timeout", billable: true });
    expect(await run(async () => Promise.reject(new TypeError("fetch failed")))).toMatchObject({ code: "provider_network", billable: false });
    expect(await run(async () => new Response("<html>", { status: 200 }))).toMatchObject({ code: "provider_bad_response", billable: true });
    expect(await run(async () => new Response("{}", { status: 503 }))).toMatchObject({ billable: true });
    expect(await run(async () => new Response("{}", { status: 429 }))).toMatchObject({ billable: true });
    const bad = await run(async () => new Response("{}", { status: 400 }));
    expect(bad).toBeInstanceOf(ProviderHttpError);
    expect(bad).toMatchObject({ billable: false });
  });

  it("rag: a provider timeout on the paid chat call stays spent; a 400 refusal is refunded", async () => {
    const before = await used();
    await expect(ask(failing(new PipelineError("provider_timeout", "timed out", true, true)))).rejects.toMatchObject({ code: "provider_timeout" });
    expect(await used()).toBe(before + 1);
    // refused before anything was paid (embedding request rejected with 400): refunded
    const refused = new Dim1536FakeProvider();
    refused.embed = async () => {
      throw new ProviderHttpError("p", 400, "bad");
    };
    await expect(ask(refused)).rejects.toMatchObject({ status: 400 });
    expect(await used()).toBe(before + 1);
  });

  it("generate: timeout stays spent, refusal is refunded", async () => {
    const before = await used();
    const g = (p: Dim1536FakeProvider) => generateSummary({ repo: env.repo, provider: p, models, now: () => T }, { userId: ids.alice, documentId: docA, kind: "exam" });
    await expect(g(failing(new PipelineError("provider_timeout", "t", true, true)))).rejects.toMatchObject({ code: "provider_timeout" });
    expect(await used()).toBe(before + 1);
    await expect(g(failing(new ProviderHttpError("p", 401, "no")))).rejects.toBeDefined();
    expect(await used()).toBe(before + 1);
  });

  it("rag: zero retrieval after the paid embedding is NOT refunded", async () => {
    const repo = Object.create(env.repo);
    repo.matchChunks = async () => [];
    const before = await used();
    const r = await askDocument({ repo, provider: new Dim1536FakeProvider(), models, now: () => T }, { userId: ids.alice, documentId: docA, question: "Salam?" });
    expect(r.grounded).toBe(false);
    expect(await used()).toBe(before + 1);
  });

  it("rag: a document with no chunks costs no quota and no embedding call", async () => {
    const empty = await insertDoc(env.db, ids.alice, { status: "ready" });
    const p = new Dim1536FakeProvider();
    const before = await used();
    const r = await askDocument({ repo: env.repo, provider: p, models, now: () => T }, { userId: ids.alice, documentId: empty, question: "Salam?" });
    expect(r.grounded).toBe(false);
    expect(p.calls).toHaveLength(0);
    expect(await used()).toBe(before);
  });
});

describe("job lifecycle", () => {
  const job = async (name: string, t: Date) => {
    await env.db.exec("delete from public.processing_jobs");
    const id = await putDoc(env, storage, ids.bob, name, MIME.docx, await buildDocx(["job text"]));
    const { job: j } = await submitDocument({ repo: env.repo, now: () => t }, { documentId: id, userId: ids.bob });
    return { id, j };
  };

  it("fenced commit completes the job in the same transaction (recoverStuck cannot touch it)", async () => {
    const t = new Date("2026-10-02T00:00:00Z");
    const { id, j } = await job("fence.docx", t);
    await env.repo.claimJob("w1", t);
    await processDocument(baseDeps(env, storage, { now: () => t }), id, { jobId: j.id, workerId: "w1" });
    const row = (await env.repo.getJob(j.id))!;
    expect(row).toMatchObject({ state: "succeeded", lockedBy: null });
    expect(await env.repo.recoverStuckJobs(new Date(t.getTime() + 3_600_000), 60_000)).toEqual([]);
    expect(await env.repo.completeJob(j.id, "w1", t)).toBe(true); // runner's completeJob stays a success
  });

  it("heartbeat bumps locked_at between embedding batches", async () => {
    const t = new Date("2026-10-03T00:00:00Z");
    const later = new Date(t.getTime() + 5 * 60_000);
    await env.db.exec("delete from public.processing_jobs");
    const id = await putDoc(env, storage, ids.bob, "hb.docx", MIME.docx, await buildDocx(Array.from({ length: 12 }, (_, i) => `Paragraph ${i} ${"word ".repeat(60)}`)));
    const { job: j } = await submitDocument({ repo: env.repo, now: () => t }, { documentId: id, userId: ids.bob });
    await env.repo.claimJob("w1", t);
    const deps = baseDeps(env, storage, { now: () => later, provider: new Dim1536FakeProvider(), chunk: { maxChars: 300, overlap: 30 }, embedBatchSize: 3 });
    const beats: Date[] = [];
    const orig = env.repo.heartbeatJob.bind(env.repo);
    const repo = Object.create(env.repo);
    repo.heartbeatJob = async (a: string, b: string, c: Date) => (beats.push(c), orig(a, b, c));
    await processDocument({ ...deps, repo }, id, { jobId: j.id, workerId: "w1" });
    expect(beats.length).toBeGreaterThan(1);
  });

  it("heartbeat fails with lock_lost when the lock was recovered", async () => {
    const t = new Date("2026-10-03T12:00:00Z");
    const { id, j } = await job("hb2.docx", t);
    await env.repo.claimJob("w1", t);
    expect(await env.repo.heartbeatJob(j.id, "w1", t)).toBe(true);
    await env.repo.recoverStuckJobs(new Date(t.getTime() + 3_600_000), 60_000);
    expect(await env.repo.heartbeatJob(j.id, "w1", t)).toBe(false);
    await expect(processDocument(baseDeps(env, storage), id, { jobId: j.id, workerId: "w1" })).rejects.toMatchObject({ code: "lock_lost" });
  });

  it("terminal hook never overwrites a ready document", async () => {
    const t = new Date("2026-10-04T00:00:00Z");
    const { id, j } = await job("ready.docx", t);
    await processDocument(baseDeps(env, storage), id);
    const hooked = documentJobRunner(baseDeps(env, storage), "x");
    await env.repo.claimJob("w", t);
    await env.repo.failJob(j.id, "w", t, "boom", { retryable: false, backoffMs: () => 0 });
    await hooked.sweepTerminal();
    expect((await env.repo.getDocument(id))!.status).toBe("ready");
  });

  it("a throwing hook does not hide the outcome; sweep re-runs it and releases quota exactly once", async () => {
    const t = new Date("2026-10-05T00:00:00Z");
    await env.db.exec("delete from public.processing_jobs");
    const id = await putDoc(env, storage, ids.bob, "bad.pdf", MIME.pdf, new TextEncoder().encode("%PDF-1.7\nnope"));
    const before = (await env.repo.getUsage(ids.bob, t)).docsThisMonth;
    const { job: j } = await submitDocument({ repo: env.repo, now: () => t }, { documentId: id, userId: ids.bob });
    const handlers = documentJobRunner(baseDeps(env, storage, { now: () => t }), "h");
    void handlers;
    const crashing = new JobRunner({
      repo: env.repo,
      workerId: "w",
      handlers: { extract_text: async (jb) => void (await processDocument(baseDeps(env, storage, { now: () => t }), jb.documentId)) },
      onTerminalFailure: async () => {
        throw new Error("hook crashed");
      },
    });
    expect((await crashing.runOnce(t)).status).toBe("failed");
    expect((await env.repo.getUsage(ids.bob, t)).docsThisMonth).toBe(before + 1); // not released yet
    expect(await documentJobRunner(baseDeps(env, storage), "sweeper").sweepTerminal()).toEqual([j.id]);
    expect((await env.repo.getUsage(ids.bob, t)).docsThisMonth).toBe(before);
    expect(await documentJobRunner(baseDeps(env, storage), "sweeper").sweepTerminal()).toEqual([]);
  });

  it("enqueue error after the insert committed returns the job instead of releasing the quota", async () => {
    const t = new Date("2026-10-06T00:00:00Z");
    await env.db.exec("delete from public.processing_jobs");
    const id = await putDoc(env, storage, ids.bob, "enq.docx", MIME.docx, await buildDocx(["x"]));
    const before = (await env.repo.getUsage(ids.bob, t)).docsThisMonth;
    const repo = Object.create(env.repo);
    repo.enqueueJob = async (i: any) => {
      await env.repo.enqueueJob(i);
      throw new Error("connection reset");
    };
    const r = await submitDocument({ repo, now: () => t }, { documentId: id, userId: ids.bob });
    expect(r.job.idempotencyKey).toBe(`process-document:${id}`);
    expect((await env.repo.getUsage(ids.bob, t)).docsThisMonth).toBe(before + 1);
    // no job existed: the unit is released and enqueue_failed surfaces
    const id2 = await putDoc(env, storage, ids.bob, "enq2.docx", MIME.docx, await buildDocx(["x"]));
    const repo2 = Object.create(env.repo);
    repo2.enqueueJob = async () => {
      throw new Error("down");
    };
    await expect(submitDocument({ repo: repo2, now: () => t }, { documentId: id2, userId: ids.bob })).rejects.toMatchObject({ code: "enqueue_failed" });
    expect((await env.repo.getUsage(ids.bob, t)).docsThisMonth).toBe(before + 1);
  });
});

describe("zip hardening (second pass)", () => {
  const dvOf = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
  const records = (b: Uint8Array, sig: number) => {
    const d = dvOf(b);
    const out: number[] = [];
    for (let i = 0; i < b.length - 4; i++) if (d.getUint32(i, true) === sig) out.push(i);
    return out;
  };
  const two = async (opts: { compression?: "STORE" | "DEFLATE"; names?: [string, string] } = {}) => {
    const z = new JSZip();
    const [a, b] = opts.names ?? ["word/document.xml", "word/other.xml"];
    z.file(a, "<w:p><w:t>one</w:t></w:p>".repeat(20));
    z.file(b, "<w:p><w:t>two</w:t></w:p>".repeat(20));
    return z.generateAsync({ type: "uint8array", compression: opts.compression ?? "STORE" });
  };

  it("case-insensitive duplicate names are rejected", async () => {
    await expect(extractDocx(await two({ names: ["word/document.xml", "WORD/Document.xml"] }))).rejects.toMatchObject({ code: "archive_rejected", message: expect.stringMatching(/duplicate/) });
  });

  it("overlapping entries are rejected", async () => {
    const b = await two();
    const cen = records(b, 0x02014b50);
    dvOf(b).setUint32(cen[0]! + 20, dvOf(b).getUint32(cen[0]! + 20, true) + 10, true); // first entry now spans into the second
    expect(() => readCentralDirectory(b)).toThrowError(/overlapping/);
  });

  it("local compression method must equal the central one", async () => {
    const b = await two({ compression: "DEFLATE" });
    const loc = records(b, 0x04034b50);
    dvOf(b).setUint16(loc[1]! + 8, 0, true);
    await expect(extractDocx(b)).rejects.toMatchObject({ code: "corrupt_archive" });
  });

  it("local encryption flag must be clear", async () => {
    const b = await two();
    const loc = records(b, 0x04034b50);
    dvOf(b).setUint16(loc[1]! + 6, 1, true);
    await expect(extractDocx(b)).rejects.toMatchObject({ code: "archive_rejected" });
  });

  it("CRC-32 mismatch is rejected", async () => {
    const b = await two();
    const cen = records(b, 0x02014b50);
    dvOf(b).setUint32(cen[1]! + 16, 0xdeadbeef, true);
    await expect(extractDocx(b)).rejects.toMatchObject({ code: "corrupt_archive", message: expect.stringMatching(/CRC/) });
  });

  it("invalid UTF-8 entry names are rejected", async () => {
    const b = await two();
    const cen = records(b, 0x02014b50);
    b[cen[0]! + 46] = 0xff;
    expect(() => readCentralDirectory(b)).toThrowError(/UTF-8/);
  });

  it("two end-of-central-directory candidates passing the end check are rejected", async () => {
    const b = await two();
    const e = records(b, 0x06054b50).at(-1)!;
    const eocd = b.slice(e);
    dvOf(eocd).setUint16(20, 22, true);
    const fake = new Uint8Array(22);
    dvOf(fake).setUint32(0, 0x06054b50, true);
    const out = new Uint8Array(e + 44);
    out.set(b.slice(0, e));
    out.set(eocd, e);
    out.set(fake, e + 22);
    expect(() => readCentralDirectory(out)).toThrowError(/ambiguous/);
  });
});
