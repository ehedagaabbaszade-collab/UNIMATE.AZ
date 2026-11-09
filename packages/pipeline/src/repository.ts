import type { StudyLanguage } from "./languages";
import type { PlanId, PlanUsage } from "@unimate/core";

export type JobState = "queued" | "running" | "succeeded" | "failed" | "dead";
export type JobKind = "extract_text" | "chunk" | "embed" | "summarize" | "generate_quiz" | "generate_flashcards";
export type DocStatus = "pending_upload" | "uploaded" | "processing" | "ready" | "failed";
export type UsageKind = "ai_message" | "upload_doc";

export interface Job {
  id: string;
  documentId: string;
  userId: string;
  kind: JobKind;
  state: JobState;
  attempts: number;
  maxAttempts: number;
  runAfter: Date;
  lastError: string | null;
  lockedAt: Date | null;
  lockedBy: string | null;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  /** Only set by enqueueJob: false when an existing job with the same idempotency key was returned. */
  created?: boolean;
}
export interface EnqueueInput {
  documentId: string;
  userId: string;
  kind: JobKind;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
  runAfter?: Date;
}
export interface FailOutcome {
  state: "queued" | "dead" | "failed";
  runAfter?: Date;
}

export interface DocumentRow {
  id: string;
  userId: string;
  title: string;
  originalFilename: string | null;
  storagePath: string;
  mimeType: string;
  sizeBytes: number | null;
  status: DocStatus;
  pageCount: number | null;
  error: string | null;
}
export interface PageRow {
  page: number;
  text: string;
}
export interface NewChunk {
  index: number;
  pageStart: number;
  pageEnd: number;
  text: string;
  tokenCount: number;
  embedding: number[];
  /** Deterministic chunkPages id, kept for traceability. The row id is a DB uuid. */
  sourceId: string;
}
export interface ChunkRow {
  id: string;
  index: number;
  pageStart: number | null;
  pageEnd: number | null;
  text: string;
}
export interface MatchedChunk extends ChunkRow {
  documentId: string;
  similarity: number;
}
export interface MessageInput {
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations?: unknown[];
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
}
export interface AiUsageInput {
  userId: string;
  feature: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
}
export interface PromptVersion {
  id: string;
  name: string;
  version: number;
  template: string;
  model: string | null;
}
export type SummaryKind = "short" | "detailed" | "exam";

/** Persistence used by the pipeline. The SQL implementation runs as service_role, except matchChunks. */
export interface Repository {
  // jobs
  enqueueJob(input: EnqueueInput): Promise<Job>;
  getJob(id: string): Promise<Job | null>;
  getJobByIdempotencyKey(key: string): Promise<Job | null>;
  /** Bumps locked_at of a running job we hold. False when the lock was lost. */
  heartbeatJob(id: string, workerId: string, now: Date): Promise<boolean>;
  /** Terminal (failed/dead) jobs that carry a quotaPeriod but no quotaReleased marker (hook crashed or failed). */
  listUnreleasedTerminalJobs(limit?: number): Promise<Job[]>;
  /** Atomically claims one due queued job (attempts is incremented). Null when none. */
  claimJob(workerId: string, now: Date, kinds?: JobKind[]): Promise<Job | null>;
  completeJob(id: string, workerId: string, now: Date): Promise<boolean>;
  /** retryable: requeue with backoff, or dead when attempts are exhausted. Not retryable: state "failed". */
  failJob(
    id: string,
    workerId: string,
    now: Date,
    error: string,
    opts: { retryable: boolean; backoffMs: (attempts: number) => number },
  ): Promise<FailOutcome | null>;
  /** Running jobs locked before now - staleMs go back to queued, or dead if out of attempts. Returns ids. */
  recoverStuckJobs(now: Date, staleMs: number): Promise<Array<{ id: string; state: JobState }>>;

  // documents
  getDocument(id: string): Promise<DocumentRow | null>;
  /** `unlessStatus`: skip the update when the document currently has that status (e.g. never overwrite 'ready'). */
  setDocumentStatus(id: string, status: DocStatus, extra?: { pageCount?: number; error?: string | null; unlessStatus?: DocStatus }): Promise<void>;
  replaceDocumentContent(documentId: string, pages: PageRow[], chunks: NewChunk[]): Promise<void>;
  /**
   * Replaces pages/chunks AND flips the document to ready in ONE transaction. With `fence`, the write only happens
   * while processing_jobs.<jobId> is still 'running' and locked by workerId (row-locked for the transaction);
   * otherwise it throws PipelineError("lock_lost") and writes nothing, so a zombie worker cannot clobber a newer run.
   */
  commitDocumentContent(input: {
    documentId: string;
    pages: PageRow[];
    chunks: NewChunk[];
    pageCount: number;
    fence?: { jobId: string; workerId: string };
  }): Promise<void>;
  /** Exactly-once quota release for a job: marks payload.quotaReleased and releases in one transaction. False if already released. */
  releaseJobUsage(job: { id: string; userId: string }, kind: UsageKind, periodStart: string): Promise<boolean>;
  getChunks(documentId: string, limit?: number): Promise<ChunkRow[]>;

  // retrieval (runs as the end user so RLS + match_chunks' auth.uid() apply)
  matchChunks(userId: string, embedding: number[], documentId: string, k: number): Promise<MatchedChunk[]>;

  // plans and quota
  /** Effective plan at `now` (SQL public.effective_plan: live status and not past its expiry; free otherwise). */
  getPlan(userId: string, now: Date): Promise<PlanId>;
  /** The user's profiles.locale (default output language of generated material); az when unknown. */
  getLocale(userId: string): Promise<StudyLanguage>;
  /** Atomic conditional increment. Returns the new count, or null when n >= limit. */
  bumpUsage(userId: string, kind: UsageKind, periodStart: string, limit: number): Promise<number | null>;
  releaseUsage(userId: string, kind: UsageKind, periodStart: string): Promise<void>;
  getUsage(userId: string, now: Date): Promise<PlanUsage>;

  // chat and study material
  createConversation(userId: string, documentId: string, title?: string, language?: { outputLanguage?: StudyLanguage; sourceLanguage?: StudyLanguage }): Promise<string>;
  conversationOwner(conversationId: string): Promise<{ userId: string; documentId: string | null } | null>;
  insertMessage(m: MessageInput): Promise<string>;
  recordAiUsage(u: AiUsageInput): Promise<void>;
  ensurePromptVersion(name: string, template: string, model?: string): Promise<PromptVersion>;
  getCachedGeneration(documentId: string, promptVersionId: string, paramsHash: string): Promise<unknown | null>;
  putCachedGeneration(input: {
    userId: string;
    documentId: string;
    promptVersionId: string;
    paramsHash: string;
    output: unknown;
    model: string;
  }): Promise<void>;
  insertSummary(input: {
    userId: string;
    documentId: string;
    kind: SummaryKind;
    content: string;
    model: string;
    promptVersionId: string;
    outputLanguage?: string;
    sourceLanguage?: string | null;
  }): Promise<string>;
  /**
   * Persists a generated quiz server-side (quizzes.server_generated = true; answer + explanation go to the private key
   * table) and returns ONLY the public view (no answers). Idempotent per (user, document, hash): a repeat returns the
   * existing quiz.
   */
  ensureQuiz(input: {
    userId: string;
    documentId: string;
    hash: string;
    title: string;
    outputLanguage: StudyLanguage;
    sourceLanguage: StudyLanguage | null;
    questions: { prompt: string; options: string[]; answer: string; explanation: string }[];
  }): Promise<{ quizId: string; questions: { id: string; prompt: string; options: string[] }[] }>;
}
