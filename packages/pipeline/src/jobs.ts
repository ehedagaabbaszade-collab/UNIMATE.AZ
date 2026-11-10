import { PipelineError, sanitizeError } from "./errors";
import type { FailOutcome, Job, JobKind, Repository } from "./repository";

export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
}
export const DEFAULT_BACKOFF: BackoffOptions = { baseMs: 5_000, maxMs: 15 * 60_000 };

/** Exponential backoff after the nth failed attempt (1-based): base * 2^(n-1), capped at maxMs. */
export function backoffMs(attempts: number, opts: BackoffOptions = DEFAULT_BACKOFF): number {
  const exp = Math.max(0, attempts - 1);
  return Math.min(opts.maxMs, opts.baseMs * 2 ** Math.min(exp, 30));
}

export type JobHandler = (job: Job) => Promise<void>;

export type RunResult =
  | { status: "idle" }
  | { status: "succeeded"; jobId: string }
  | { status: "retry_scheduled"; jobId: string; runAfter: Date; error: string }
  | { status: "dead" | "failed"; jobId: string; error: string }
  | { status: "lock_lost"; jobId: string };

export interface JobRunnerOptions {
  repo: Repository;
  workerId: string;
  handlers: Partial<Record<JobKind, JobHandler>>;
  backoff?: BackoffOptions;
  /** A running job locked longer ago than this is presumed crashed. */
  staleLockMs?: number;
  /** Called on terminal failure (failed/dead) so callers can mark the document failed, release quota, etc. */
  onTerminalFailure?: (job: Job, error: string) => Promise<void>;
}

/**
 * Job states (processing_jobs.state):
 *   queued    -> waiting; claimable once run_after <= now
 *   running   -> claimed by one worker (attempts incremented at claim time)
 *   succeeded -> done
 *   queued    -> (again) after a retryable failure, with run_after = now + exponential backoff
 *   dead      -> retryable failures exhausted max_attempts (dead letter; needs manual requeue)
 *   failed    -> permanent failure that retrying cannot fix (e.g. unsupported file); never retried
 */
export class JobRunner {
  private readonly backoff: BackoffOptions;
  constructor(private readonly o: JobRunnerOptions) {
    this.backoff = o.backoff ?? DEFAULT_BACKOFF;
  }

  /**
   * Requeue (or dead-letter) jobs whose worker vanished. Jobs that end up dead get the same terminal-failure
   * hook as a normal failure, so documents do not stay "processing" and quota is released. Returns recovered ids.
   */
  async recoverStuck(now: Date): Promise<string[]> {
    const recovered = await this.o.repo.recoverStuckJobs(now, this.o.staleLockMs ?? 10 * 60_000);
    for (const r of recovered) {
      if (r.state !== "dead") continue;
      const job = await this.o.repo.getJob(r.id);
      if (job) await this.hook(job, job.lastError ?? "lock expired: worker presumed crashed");
    }
    await this.sweepTerminal();
    return recovered.map((r) => r.id);
  }

  /** Terminal jobs whose hook failed or never ran (no quotaReleased marker) get the hook again. Returns ids swept. */
  async sweepTerminal(): Promise<string[]> {
    const jobs = await this.o.repo.listUnreleasedTerminalJobs();
    for (const j of jobs) await this.hook(j, j.lastError ?? "job failed");
    return jobs.map((j) => j.id);
  }

  /** One hook failure must not hide the original outcome or stop the loop; the sweep retries it later. */
  private async hook(job: Job, error: string): Promise<void> {
    try {
      await this.o.onTerminalFailure?.(job, error);
    } catch {
      /* retried by sweepTerminal */
    }
  }

  /** Claims and runs at most one job. `now` is injectable so tests need no sleeping. */
  async runOnce(now: Date = new Date(), kinds?: JobKind[]): Promise<RunResult> {
    const { repo, workerId } = this.o;
    const job = await repo.claimJob(workerId, now, kinds);
    if (!job) return { status: "idle" };

    const handler = this.o.handlers[job.kind];
    try {
      if (!handler) throw new PipelineError("no_handler", `No handler registered for job kind ${job.kind}`);
      await handler(job);
    } catch (e) {
      const error = sanitizeError(e);
      const retryable = e instanceof PipelineError ? e.retryable : true; // unknown errors: assume transient
      const outcome: FailOutcome | null = await repo.failJob(job.id, workerId, now, error, {
        retryable,
        backoffMs: (n) => backoffMs(n, this.backoff),
      });
      if (!outcome) return { status: "lock_lost", jobId: job.id };
      if (outcome.state === "queued") return { status: "retry_scheduled", jobId: job.id, runAfter: outcome.runAfter!, error };
      await this.hook(job, error);
      return { status: outcome.state, jobId: job.id, error };
    }
    const ok = await repo.completeJob(job.id, workerId, now);
    return ok ? { status: "succeeded", jobId: job.id } : { status: "lock_lost", jobId: job.id };
  }
}
