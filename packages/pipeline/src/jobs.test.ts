import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PipelineError, sanitizeError } from "./errors";
import { JobRunner, backoffMs } from "./jobs";
import { createEnv, ids, insertDoc, type TestEnv } from "./test-utils";

let env: TestEnv;
let docId: string;
beforeAll(async () => {
  env = await createEnv();
  docId = await insertDoc(env.db, ids.alice);
}, 120_000);
afterAll(async () => {
  await env.db.close();
});

const T0 = new Date("2026-03-01T10:00:00Z");
let seq = 0;
const enqueue = (o: { maxAttempts?: number; key?: string } = {}) =>
  env.repo.enqueueJob({
    documentId: docId,
    userId: ids.alice,
    kind: "extract_text",
    idempotencyKey: o.key ?? `job-key-${++seq}-${Math.random()}`,
    runAfter: T0,
    ...(o.maxAttempts ? { maxAttempts: o.maxAttempts } : {}),
  });

describe("backoffMs", () => {
  it("is exponential and capped", () => {
    expect([1, 2, 3, 4].map((n) => backoffMs(n, { baseMs: 1000, maxMs: 5000 }))).toEqual([1000, 2000, 4000, 5000]);
    expect(backoffMs(500, { baseMs: 1000, maxMs: 5000 })).toBe(5000);
  });
});

describe("enqueue idempotency", () => {
  it("returns the same job for the same key", async () => {
    const a = await enqueue({ key: "idempotent-key-1" });
    const b = await enqueue({ key: "idempotent-key-1" });
    expect(b.id).toBe(a.id);
    const { rows } = await env.db.query("select count(*)::int as n from public.processing_jobs where idempotency_key = 'idempotent-key-1'");
    expect((rows[0] as { n: number }).n).toBe(1);
    // drain it so later tests start clean
    await env.repo.claimJob("drain", T0);
  });
});

describe("claim", () => {
  it("two workers claiming in parallel: exactly one wins the single job", async () => {
    await env.db.exec("delete from public.processing_jobs");
    await enqueue();
    const [a, b] = await Promise.all([env.repo.claimJob("w1", T0), env.repo.claimJob("w2", T0)]);
    const winners = [a, b].filter(Boolean);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.state).toBe("running");
    expect(winners[0]!.attempts).toBe(1);
    expect(winners[0]!.lockedBy).toBe(winners[0] === a ? "w1" : "w2");
  });

  it("N workers, N jobs: each job claimed exactly once", async () => {
    await env.db.exec("delete from public.processing_jobs");
    for (let i = 0; i < 5; i++) await enqueue();
    const claims = await Promise.all(Array.from({ length: 8 }, (_, i) => env.repo.claimJob(`w${i}`, T0)));
    const got = claims.filter(Boolean).map((j) => j!.id);
    expect(got).toHaveLength(5);
    expect(new Set(got).size).toBe(5);
  });

  it("does not claim jobs before run_after", async () => {
    await env.db.exec("delete from public.processing_jobs");
    await env.repo.enqueueJob({ documentId: docId, userId: ids.alice, kind: "extract_text", idempotencyKey: "future-job-1", runAfter: new Date(T0.getTime() + 60_000) });
    expect(await env.repo.claimJob("w", T0)).toBeNull();
    expect(await env.repo.claimJob("w", new Date(T0.getTime() + 60_000))).not.toBeNull();
  });
});

describe("retry, dead letter, failed", () => {
  it("retries with exponential backoff, then dead-letters at max attempts; last_error has no stack or secrets", async () => {
    await env.db.exec("delete from public.processing_jobs");
    const job = await enqueue({ maxAttempts: 3 });
    const runner = new JobRunner({
      repo: env.repo,
      workerId: "w",
      backoff: { baseMs: 1000, maxMs: 60_000 },
      handlers: {
        extract_text: async () => {
          throw new Error("upstream said 401 for Bearer sk-live-abcdefghijklmnop at postgres://u:pw@host/db\n    at secretStack (/srv/app.js:1:1)");
        },
      },
    });

    let now = T0;
    const r1 = await runner.runOnce(now);
    expect(r1).toMatchObject({ status: "retry_scheduled" });
    expect((r1 as { runAfter: Date }).runAfter.getTime()).toBe(T0.getTime() + 1000);
    expect(await runner.runOnce(now)).toEqual({ status: "idle" }); // backoff not elapsed

    now = new Date(T0.getTime() + 1000);
    const r2 = await runner.runOnce(now);
    expect((r2 as { runAfter: Date }).runAfter.getTime()).toBe(now.getTime() + 2000);

    now = new Date(now.getTime() + 2000);
    const r3 = await runner.runOnce(now);
    expect(r3.status).toBe("dead");

    const j = (await env.repo.getJob(job.id))!;
    expect(j.state).toBe("dead");
    expect(j.attempts).toBe(3);
    expect(j.lockedBy).toBeNull();
    expect(j.lastError).not.toMatch(/sk-live|postgres:\/\/|secretStack|\n/);
    expect(j.lastError).toContain("Error");
    expect(await runner.runOnce(new Date(now.getTime() + 1e9))).toEqual({ status: "idle" });
  });

  it("non-retryable PipelineError goes to failed immediately; success completes", async () => {
    await env.db.exec("delete from public.processing_jobs");
    const bad = await enqueue();
    const failed: string[] = [];
    const runner = new JobRunner({
      repo: env.repo,
      workerId: "w",
      handlers: { extract_text: async () => { throw new PipelineError("unsupported", "Unsupported file", false); } },
      onTerminalFailure: async (j, e) => void failed.push(`${j.id}:${e}`),
    });
    expect(await runner.runOnce(T0)).toMatchObject({ status: "failed" });
    expect((await env.repo.getJob(bad.id))!.state).toBe("failed");
    expect(failed).toEqual([`${bad.id}:unsupported: Unsupported file`]);

    const good = await enqueue();
    const ok = new JobRunner({ repo: env.repo, workerId: "w", handlers: { extract_text: async () => {} } });
    expect(await ok.runOnce(T0)).toEqual({ status: "succeeded", jobId: good.id });
    expect((await env.repo.getJob(good.id))!.state).toBe("succeeded");
  });

  it("missing handler is a terminal failure, not a crash", async () => {
    await env.db.exec("delete from public.processing_jobs");
    await enqueue();
    const r = await new JobRunner({ repo: env.repo, workerId: "w", handlers: {} }).runOnce(T0);
    expect(r.status).toBe("failed");
  });
});

describe("stuck job recovery", () => {
  it("requeues stale running jobs, dead-letters exhausted ones, leaves fresh ones alone", async () => {
    await env.db.exec("delete from public.processing_jobs");
    const stale = await enqueue();
    const exhausted = await enqueue({ maxAttempts: 1 });
    const fresh = await enqueue();
    await env.repo.claimJob("crashed", T0); // claims in created order
    await env.repo.claimJob("crashed", T0);
    const later = new Date(T0.getTime() + 20 * 60_000);
    await env.repo.claimJob("alive", later); // fresh one locked "now"
    const runner = new JobRunner({ repo: env.repo, workerId: "r", handlers: {}, staleLockMs: 10 * 60_000 });
    const recovered = await runner.recoverStuck(later);
    expect(recovered.sort()).toEqual([stale.id, exhausted.id].sort());
    expect((await env.repo.getJob(stale.id))!.state).toBe("queued");
    expect((await env.repo.getJob(exhausted.id))!.state).toBe("dead");
    expect((await env.repo.getJob(fresh.id))!.state).toBe("running");
    // a zombie worker finishing late cannot overwrite the recovered job
    expect(await env.repo.completeJob(stale.id, "crashed", later)).toBe(false);
  });
});

describe("sanitizeError", () => {
  it("drops stack, redacts secrets, truncates", () => {
    const e = new Error("fetch failed https://api.x.com/v1?api_key=SECRET123&a=1 Authorization: Bearer abcdefgh12345\n at foo");
    const s = sanitizeError(e);
    expect(s).not.toMatch(/SECRET123|abcdefgh12345|at foo/);
    expect(sanitizeError(new Error("x".repeat(5000))).length).toBeLessThan(400);
    expect(sanitizeError("weird")).toBe("Unknown error");
  });
});
