import { parseLanguage, type StudyLanguage } from "./languages";
import type { PlanId, PlanUsage } from "@unimate/core";
import type {
  AiUsageInput,
  ChunkRow,
  DocStatus,
  DocumentRow,
  EnqueueInput,
  FailOutcome,
  Job,
  JobKind,
  JobState,
  MatchedChunk,
  MessageInput,
  NewChunk,
  PageRow,
  PromptVersion,
  Repository,
  SummaryKind,
  UsageKind,
} from "./repository";
import { PipelineError } from "./errors";
import { dayStart, monthStart } from "./quota-periods";

/** Satisfied by PGlite and its Transaction. */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[]; affectedRows?: number }>;
}
/** Runs fn in a transaction with the given database role. `user` must set auth.uid() to userId. */
export interface SqlExecutor {
  service<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  user<T>(userId: string, fn: (q: Queryable) => Promise<T>): Promise<T>;
}

type Row = Record<string, any>;
const iso = (d: Date) => d.toISOString();
const vec = (v: number[]) => `[${v.join(",")}]`;

const toJob = (r: Row): Job => ({
  id: r.id,
  documentId: r.document_id,
  userId: r.user_id,
  kind: r.kind,
  state: r.state,
  attempts: r.attempts,
  maxAttempts: r.max_attempts,
  runAfter: new Date(r.run_after),
  lastError: r.last_error,
  lockedAt: r.locked_at ? new Date(r.locked_at) : null,
  lockedBy: r.locked_by,
  payload: r.payload,
  idempotencyKey: r.idempotency_key,
});
const toDoc = (r: Row): DocumentRow => ({
  id: r.id,
  userId: r.user_id,
  title: r.title,
  originalFilename: r.original_filename,
  storagePath: r.storage_path,
  mimeType: r.mime_type,
  sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
  status: r.status,
  pageCount: r.page_count,
  error: r.error,
});
const toChunk = (r: Row): ChunkRow => ({
  id: r.id,
  index: r.chunk_index,
  pageStart: r.page_start,
  pageEnd: r.page_end,
  text: r.content,
});

const SUB_PLAN: Record<string, PlanId> = { free: "FREE", plus: "PLUS", pro: "PRO" };

export class SqlRepository implements Repository {
  constructor(private readonly exec: SqlExecutor) {}

  // ------------------------------------------------------------ jobs
  async enqueueJob(i: EnqueueInput): Promise<Job> {
    const { rows } = await this.exec.service((q) =>
      q.query<Row>(
        `insert into public.processing_jobs (document_id, user_id, kind, payload, idempotency_key, max_attempts, run_after)
         values ($1, $2, $3, $4::jsonb, $5, $6, coalesce($7::timestamptz, now()))
         on conflict (idempotency_key) do update set idempotency_key = excluded.idempotency_key
         returning *, (xmax = 0) as created`,
        [i.documentId, i.userId, i.kind, JSON.stringify(i.payload ?? {}), i.idempotencyKey, i.maxAttempts ?? 5, i.runAfter ? iso(i.runAfter) : null],
      ),
    );
    return { ...toJob(rows[0]!), created: Boolean(rows[0]!.created) };
  }

  async getJob(id: string): Promise<Job | null> {
    const { rows } = await this.exec.service((q) => q.query<Row>("select * from public.processing_jobs where id = $1", [id]));
    return rows[0] ? toJob(rows[0]) : null;
  }

  async getJobByIdempotencyKey(key: string): Promise<Job | null> {
    const { rows } = await this.exec.service((q) => q.query<Row>("select * from public.processing_jobs where idempotency_key = $1", [key]));
    return rows[0] ? toJob(rows[0]) : null;
  }

  async heartbeatJob(id: string, workerId: string, now: Date): Promise<boolean> {
    const r = await this.exec.service((q) =>
      q.query(
        "update public.processing_jobs set locked_at = $3::timestamptz, updated_at = $3::timestamptz where id = $1 and locked_by = $2 and state = 'running'",
        [id, workerId, iso(now)],
      ),
    );
    return (r.affectedRows ?? 0) === 1;
  }

  async listUnreleasedTerminalJobs(limit = 50): Promise<Job[]> {
    const { rows } = await this.exec.service((q) =>
      q.query<Row>(
        `select * from public.processing_jobs
          where state in ('failed', 'dead') and payload ? 'quotaPeriod' and coalesce(payload->>'quotaReleased', 'false') <> 'true'
          order by updated_at limit $1`,
        [limit],
      ),
    );
    return rows.map(toJob);
  }

  async claimJob(workerId: string, now: Date, kinds?: JobKind[]): Promise<Job | null> {
    // One atomic statement: the inner SELECT locks a single due row and skips rows other workers hold.
    const { rows } = await this.exec.service((q) =>
      q.query<Row>(
        `update public.processing_jobs
            set state = 'running', attempts = attempts + 1, locked_at = $2::timestamptz, locked_by = $1, updated_at = $2::timestamptz
          where id = (
            select id from public.processing_jobs
             where state = 'queued' and run_after <= $2::timestamptz and attempts < max_attempts
               and ($3::text[] is null or kind = any($3::text[]))
             order by run_after, created_at
             limit 1
             for update skip locked)
          returning *`,
        [workerId, iso(now), kinds ?? null],
      ),
    );
    return rows[0] ? toJob(rows[0]) : null;
  }

  async completeJob(id: string, workerId: string, now: Date): Promise<boolean> {
    return this.exec.service(async (q) => {
      const r = await q.query(
        `update public.processing_jobs set state = 'succeeded', locked_at = null, locked_by = null, last_error = null, updated_at = $3::timestamptz
          where id = $1 and locked_by = $2 and state = 'running'`,
        [id, workerId, iso(now)],
      );
      if ((r.affectedRows ?? 0) === 1) return true;
      // A fenced commitDocumentContent already completed the job inside its own transaction.
      const { rows } = await q.query<Row>("select state from public.processing_jobs where id = $1", [id]);
      return rows[0]?.state === "succeeded";
    });
  }

  async failJob(
    id: string,
    workerId: string,
    now: Date,
    error: string,
    opts: { retryable: boolean; backoffMs: (attempts: number) => number },
  ): Promise<FailOutcome | null> {
    return this.exec.service(async (q) => {
      const { rows } = await q.query<Row>(
        "select attempts, max_attempts from public.processing_jobs where id = $1 and locked_by = $2 and state = 'running' for update",
        [id, workerId],
      );
      const j = rows[0];
      if (!j) return null; // lost the lock (e.g. recovered by another worker)
      let state: FailOutcome["state"];
      let runAfter: Date | undefined;
      if (!opts.retryable) state = "failed";
      else if (j.attempts >= j.max_attempts) state = "dead";
      else {
        state = "queued";
        runAfter = new Date(now.getTime() + opts.backoffMs(j.attempts));
      }
      await q.query(
        `update public.processing_jobs
            set state = $3::public.job_state, last_error = $4, locked_at = null, locked_by = null,
                run_after = coalesce($5::timestamptz, run_after), updated_at = $6::timestamptz
          where id = $1 and locked_by = $2`,
        [id, workerId, state, error, runAfter ? iso(runAfter) : null, iso(now)],
      );
      return runAfter ? { state, runAfter } : { state };
    });
  }

  async recoverStuckJobs(now: Date, staleMs: number): Promise<Array<{ id: string; state: JobState }>> {
    const { rows } = await this.exec.service((q) =>
      q.query<Row>(
        `update public.processing_jobs
            set state = (case when attempts >= max_attempts then 'dead' else 'queued' end)::public.job_state,
                last_error = 'lock expired: worker presumed crashed', locked_at = null, locked_by = null,
                run_after = $1::timestamptz, updated_at = $1::timestamptz
          where state = 'running' and locked_at < $1::timestamptz - make_interval(secs => $2::float8 / 1000)
          returning id, state`,
        [iso(now), staleMs],
      ),
    );
    return rows.map((r) => ({ id: r.id, state: r.state }));
  }

  // ------------------------------------------------------------ documents
  async getDocument(id: string): Promise<DocumentRow | null> {
    const { rows } = await this.exec.service((q) => q.query<Row>("select * from public.documents where id = $1", [id]));
    return rows[0] ? toDoc(rows[0]) : null;
  }

  async setDocumentStatus(id: string, status: DocStatus, extra: { pageCount?: number; error?: string | null; unlessStatus?: DocStatus } = {}) {
    await this.exec.service((q) =>
      q.query(
        `update public.documents set status = $2::public.doc_status,
                page_count = coalesce($3::int, page_count), error = $4
          where id = $1 and ($5::public.doc_status is null or status <> $5::public.doc_status)`,
        [id, status, extra.pageCount ?? null, extra.error ?? null, extra.unlessStatus ?? null],
      ),
    );
  }

  private async writeContent(q: Queryable, documentId: string, pages: PageRow[], chunks: NewChunk[]): Promise<void> {
    await q.query("delete from public.generation_cache where document_id = $1", [documentId]);
    await q.query("delete from public.document_chunks where document_id = $1", [documentId]);
    await q.query("delete from public.document_pages where document_id = $1", [documentId]);
    for (const p of pages)
      await q.query("insert into public.document_pages (document_id, page_number, content) values ($1, $2, $3)", [
        documentId,
        p.page,
        p.text,
      ]);
    for (const c of chunks)
      await q.query(
        `insert into public.document_chunks (document_id, chunk_index, page_start, page_end, content, token_count, embedding, metadata)
         values ($1, $2, $3, $4, $5, $6, $7::extensions.vector, $8::jsonb)`,
        [documentId, c.index, c.pageStart, c.pageEnd, c.text, c.tokenCount, vec(c.embedding), JSON.stringify({ source_id: c.sourceId })],
      );
  }

  async replaceDocumentContent(documentId: string, pages: PageRow[], chunks: NewChunk[]): Promise<void> {
    await this.exec.service((q) => this.writeContent(q, documentId, pages, chunks));
  }

  async commitDocumentContent(i: {
    documentId: string;
    pages: PageRow[];
    chunks: NewChunk[];
    pageCount: number;
    fence?: { jobId: string; workerId: string };
  }): Promise<void> {
    await this.exec.service(async (q) => {
      if (i.fence) {
        // FOR UPDATE: a concurrent recoverStuckJobs/failJob on this job waits until we commit, so the check cannot go stale.
        const { rows } = await q.query(
          "select 1 from public.processing_jobs where id = $1 and locked_by = $2 and state = 'running' for update",
          [i.fence.jobId, i.fence.workerId],
        );
        if (rows.length === 0) throw new PipelineError("lock_lost", "Job lock was lost; discarding results", false);
      }
      await this.writeContent(q, i.documentId, i.pages, i.chunks);
      await q.query(
        "update public.documents set status = 'ready'::public.doc_status, page_count = $2::int, error = null where id = $1",
        [i.documentId, i.pageCount],
      );
      // Complete the job in the SAME transaction (row already locked above), so recoverStuck can never requeue or
      // dead-letter a job whose content is already committed.
      if (i.fence)
        await q.query(
          `update public.processing_jobs set state = 'succeeded', locked_at = null, locked_by = null, last_error = null, updated_at = now()
            where id = $1 and locked_by = $2`,
          [i.fence.jobId, i.fence.workerId],
        );
    });
  }

  async releaseJobUsage(job: { id: string; userId: string }, kind: UsageKind, periodStart: string): Promise<boolean> {
    return this.exec.service(async (q) => {
      const { rows } = await q.query(
        `update public.processing_jobs set payload = payload || '{"quotaReleased": true}'::jsonb
          where id = $1 and coalesce(payload->>'quotaReleased', 'false') <> 'true' returning id`,
        [job.id],
      );
      if (rows.length === 0) return false;
      await q.query(
        "update public.usage_counters set n = n - 1, updated_at = now() where user_id = $1 and kind = $2 and period_start = $3::date and n > 0",
        [job.userId, kind, periodStart],
      );
      return true;
    });
  }

  async getChunks(documentId: string, limit = 10_000): Promise<ChunkRow[]> {
    const { rows } = await this.exec.service((q) =>
      q.query<Row>("select * from public.document_chunks where document_id = $1 order by chunk_index limit $2", [documentId, limit]),
    );
    return rows.map(toChunk);
  }

  async matchChunks(userId: string, embedding: number[], documentId: string, k: number): Promise<MatchedChunk[]> {
    const { rows } = await this.exec.user(userId, (q) =>
      q.query<Row>("select * from public.match_chunks($1::extensions.vector, $2, $3)", [vec(embedding), documentId, k]),
    );
    return rows.map((r) => ({ ...toChunk(r), documentId: r.document_id, similarity: Number(r.similarity) }));
  }

  // ------------------------------------------------------------ plan and quota
  async getPlan(userId: string, now: Date): Promise<PlanId> {
    const { rows } = await this.exec.service((q) =>
      // One rule for every reader of plans: SQL effective_plan (live status, expiry honoured). `now` is the injectable clock.
      q.query<Row>("select public.effective_plan($1, $2::timestamptz) as plan", [userId, iso(now)]),
    );
    return SUB_PLAN[rows[0]?.plan as string] ?? "FREE";
  }

  async getLocale(userId: string): Promise<StudyLanguage> {
    const { rows } = await this.exec.service((q) => q.query<Row>("select locale from public.profiles where id = $1", [userId]));
    return parseLanguage(rows[0]?.locale) ?? "az";
  }

  async bumpUsage(userId: string, kind: UsageKind, periodStart: string, limit: number): Promise<number | null> {
    // The WHERE on DO UPDATE makes the check and the increment one atomic statement; the
    // INSERT ... SELECT guard covers the first-row case (limit 0) and concurrent first inserts.
    const { rows } = await this.exec.service((q) =>
      q.query<Row>(
        `insert into public.usage_counters as u (user_id, kind, period_start, n)
         select $1, $2, $3::date, 1 where $4::int > 0
         on conflict (user_id, kind, period_start)
           do update set n = u.n + 1, updated_at = now() where u.n < $4::int
         returning n`,
        [userId, kind, periodStart, limit],
      ),
    );
    return rows[0] ? Number(rows[0].n) : null;
  }

  async releaseUsage(userId: string, kind: UsageKind, periodStart: string): Promise<void> {
    await this.exec.service((q) =>
      q.query(
        "update public.usage_counters set n = n - 1, updated_at = now() where user_id = $1 and kind = $2 and period_start = $3::date and n > 0",
        [userId, kind, periodStart],
      ),
    );
  }

  async getUsage(userId: string, now: Date): Promise<PlanUsage> {
    const { rows } = await this.exec.service((q) =>
      q.query<Row>(
        `select kind, n from public.usage_counters
          where user_id = $1 and ((kind = 'ai_message' and period_start = $2::date) or (kind = 'upload_doc' and period_start = $3::date))`,
        [userId, dayStart(now), monthStart(now)],
      ),
    );
    const n = (k: string) => Number(rows.find((r) => r.kind === k)?.n ?? 0);
    return { aiMessagesToday: n("ai_message"), docsThisMonth: n("upload_doc") };
  }

  // ------------------------------------------------------------ chat / study material
  async createConversation(
    userId: string,
    documentId: string,
    title?: string,
    language: { outputLanguage?: StudyLanguage; sourceLanguage?: StudyLanguage } = {},
  ): Promise<string> {
    const { rows } = await this.exec.service((q) =>
      // output_language NULL -> the BEFORE INSERT trigger fills it from profiles.locale
      q.query<Row>(
        "insert into public.conversations (user_id, document_id, title, output_language, source_language) values ($1, $2, $3, $4, $5) returning id",
        [userId, documentId, title ?? null, language.outputLanguage ?? null, language.sourceLanguage ?? null],
      ),
    );
    return rows[0]!.id;
  }

  async conversationOwner(conversationId: string) {
    const { rows } = await this.exec.service((q) =>
      q.query<Row>("select user_id, document_id from public.conversations where id = $1", [conversationId]),
    );
    return rows[0] ? { userId: rows[0].user_id as string, documentId: (rows[0].document_id as string | null) ?? null } : null;
  }

  async insertMessage(m: MessageInput): Promise<string> {
    const { rows } = await this.exec.service((q) =>
      q.query<Row>(
        `insert into public.messages (conversation_id, role, content, citations, model, input_tokens, output_tokens)
         values ($1, $2::public.message_role, $3, $4::jsonb, $5, $6, $7) returning id`,
        [m.conversationId, m.role, m.content, JSON.stringify(m.citations ?? []), m.model ?? null, m.inputTokens ?? null, m.outputTokens ?? null],
      ),
    );
    return rows[0]!.id;
  }

  async recordAiUsage(u: AiUsageInput): Promise<void> {
    await this.exec.service((q) =>
      q.query(
        "insert into public.ai_usage (user_id, feature, model, input_tokens, output_tokens, cost_micro_usd) values ($1, $2, $3, $4, $5, $6)",
        [u.userId, u.feature, u.model, u.inputTokens, u.outputTokens, u.costMicroUsd],
      ),
    );
  }

  async ensurePromptVersion(name: string, template: string, model?: string): Promise<PromptVersion> {
    const toPv = (r: Row): PromptVersion => ({ id: r.id, name: r.name, version: r.version, template: r.template, model: r.model });
    return this.exec.service(async (q) => {
      // Serialise concurrent registrations of the same prompt name within this transaction.
      await q.query("select pg_advisory_xact_lock(hashtext($1))", [`prompt:${name}`]);
      const active = (await q.query<Row>("select * from public.prompt_versions where name = $1 and is_active", [name])).rows[0];
      if (active && active.template === template && (active.model ?? null) === (model ?? null)) return toPv(active);
      const next = (await q.query<Row>("select coalesce(max(version), 0) + 1 as v from public.prompt_versions where name = $1", [name])).rows[0]!;
      await q.query("update public.prompt_versions set is_active = false where name = $1 and is_active", [name]);
      const { rows } = await q.query<Row>(
        "insert into public.prompt_versions (name, version, template, model, is_active) values ($1, $2, $3, $4, true) returning *",
        [name, next.v, template, model ?? null],
      );
      return toPv(rows[0]!);
    });
  }

  async getCachedGeneration(documentId: string, promptVersionId: string, paramsHash: string): Promise<unknown | null> {
    const { rows } = await this.exec.service((q) =>
      q.query<Row>(
        "select output from public.generation_cache where document_id = $1 and prompt_version_id = $2 and params_hash = $3",
        [documentId, promptVersionId, paramsHash],
      ),
    );
    return rows[0] ? rows[0].output : null;
  }

  async putCachedGeneration(i: {
    userId: string;
    documentId: string;
    promptVersionId: string;
    paramsHash: string;
    output: unknown;
    model: string;
  }): Promise<void> {
    await this.exec.service((q) =>
      q.query(
        `insert into public.generation_cache (user_id, document_id, prompt_version_id, params_hash, output, model)
         values ($1, $2, $3, $4, $5::jsonb, $6) on conflict (document_id, prompt_version_id, params_hash) do nothing`,
        [i.userId, i.documentId, i.promptVersionId, i.paramsHash, JSON.stringify(i.output), i.model],
      ),
    );
  }

  async insertSummary(i: {
    userId: string;
    documentId: string;
    kind: SummaryKind;
    content: string;
    model: string;
    promptVersionId: string;
    outputLanguage?: string;
    sourceLanguage?: string | null;
  }): Promise<string> {
    const { rows } = await this.exec.service((q) =>
      q.query<Row>(
        `insert into public.summaries (user_id, document_id, kind, content, model, prompt_version_id, output_language, source_language)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [i.userId, i.documentId, i.kind, i.content, i.model, i.promptVersionId, i.outputLanguage ?? null, i.sourceLanguage ?? null],
      ),
    );
    return rows[0]!.id;
  }

  async ensureQuiz(i: {
    userId: string;
    documentId: string;
    hash: string;
    title: string;
    outputLanguage: StudyLanguage;
    sourceLanguage: StudyLanguage | null;
    questions: { prompt: string; options: string[]; answer: string; explanation: string }[];
  }): Promise<{ quizId: string; questions: { id: string; prompt: string; options: string[] }[] }> {
    return this.exec.service(async (q) => {
      // Serialise concurrent identical requests; the unique index (user, document, generation_hash) is the backstop.
      await q.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`quiz:${i.userId}:${i.documentId}:${i.hash}`]);
      const existing = await q.query<Row>(
        "select id from public.quizzes where user_id = $1 and document_id = $2 and generation_hash = $3 and server_generated",
        [i.userId, i.documentId, i.hash],
      );
      let quizId = existing.rows[0]?.id as string | undefined;
      if (!quizId) {
        quizId = (
          await q.query<Row>(
            `insert into public.quizzes (user_id, document_id, title, server_generated, generation_hash, output_language, source_language)
             values ($1, $2, $3, true, $4, $5, $6) returning id`,
            [i.userId, i.documentId, i.title, i.hash, i.outputLanguage, i.sourceLanguage],
          )
        ).rows[0]!.id as string;
        for (const [pos, qu] of i.questions.entries())
          // answer/explanation are moved into question_keys by the questions_move_key trigger and blanked on the row.
          await q.query(
            `insert into public.questions (quiz_id, position, kind, prompt, options, answer, explanation)
             values ($1, $2, 'mcq', $3, $4::jsonb, $5, $6)`,
            [quizId, pos, qu.prompt, JSON.stringify(qu.options), qu.answer, qu.explanation],
          );
      }
      const { rows } = await q.query<Row>("select id, prompt, options from public.questions where quiz_id = $1 order by position", [quizId]);
      return { quizId, questions: rows.map((r) => ({ id: r.id as string, prompt: r.prompt as string, options: r.options as string[] })) };
    });
  }
}
