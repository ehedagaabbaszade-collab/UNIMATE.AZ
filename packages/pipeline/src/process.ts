import { checkQuota, chunkPages, cleanText, validateUpload, type AiProvider, type FileKind, type PlanId } from "@unimate/core";
import { EMBEDDING_DIMS, embedAll, type ModelMap } from "./ai";
import { PipelineError, sanitizeError } from "./errors";
import { extractDocx, extractPptx, type ExtractedPage } from "./extract/office";
import { extractPdf } from "./extract/pdf";
import { JobRunner, type JobHandler } from "./jobs";
import { OCR_LANGUAGES, type OcrEngine, type PdfPageRasterizer } from "./ocr";
import { QuotaExceededError, consumeQuota } from "./quota";
import { monthStart } from "./quota-periods";
import type { Job, Repository } from "./repository";
import { assertStoragePath } from "./storage-path";

/** Reads objects from private storage using server-side metadata (never trust client-declared size). */
export interface StorageReader {
  /** Real object size in bytes. */
  size(path: string): Promise<number>;
  readHead(path: string, n: number): Promise<Uint8Array>;
  /** Whole object. Only called after size has been validated. */
  read(path: string): Promise<Uint8Array>;
}

export interface ProcessDeps {
  repo: Repository;
  storage: StorageReader;
  provider: AiProvider;
  models: ModelMap;
  ocr?: OcrEngine;
  rasterizePdfPage?: PdfPageRasterizer;
  now?: () => Date;
  chunk?: { maxChars: number; overlap: number };
  embedBatchSize?: number;
}

export interface ProcessResult {
  pages: number;
  chunks: number;
  ocrPages: number;
  /** Pages that had no text and could not be OCR-ed (no engine/rasterizer, or plan lacks OCR). */
  emptyPages: number[];
}

const HEAD_BYTES = 16;
const basename = (p: string) => p.split("/").pop() ?? p;

async function extractByKind(
  kind: FileKind,
  bytes: Uint8Array,
  checkPages: (pages: number) => void,
  transferPdf: boolean,
): Promise<ExtractedPage[]> {
  switch (kind) {
    case "pdf":
      return extractPdf(bytes, { checkPages, transfer: transferPdf });
    case "docx":
      return extractDocx(bytes);
    case "pptx":
      return extractPptx(bytes, { checkPages });
    case "png":
    case "jpg":
      return [{ page: 1, text: "", hasText: false }]; // image: OCR is the only way to get text
  }
}

/**
 * validate -> extract -> OCR fallback -> cleanText -> chunk -> embed -> store.
 * Idempotent: stored pages/chunks for the document are replaced atomically, so a retry is safe.
 * Throws PipelineError; `retryable` is true only for transient causes (provider/network).
 */
export async function processDocument(
  deps: ProcessDeps,
  documentId: string,
  /** When set, the final write is fenced on this job still being 'running' and locked by this worker. */
  fence?: { jobId: string; workerId: string },
): Promise<ProcessResult> {
  const { repo, storage } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const beat = async () => {
    if (fence && !(await repo.heartbeatJob(fence.jobId, fence.workerId, now))) throw new PipelineError("lock_lost", "Job lock was lost", false);
  };
  const doc = await repo.getDocument(documentId);
  if (!doc) throw new PipelineError("not_found", "Document not found", false);
  assertStoragePath(doc.storagePath, doc.userId); // before ANY storage call
  await repo.setDocumentStatus(documentId, "processing");

  // 1. validate with server-read size and head bytes
  const size = await storage.size(doc.storagePath);
  const head = await storage.readHead(doc.storagePath, HEAD_BYTES);
  const v = validateUpload({
    name: doc.originalFilename ?? basename(doc.storagePath),
    size,
    mimeType: doc.mimeType,
    headBytes: head,
  });
  if (!v.ok) throw new PipelineError(v.error, v.message, false);

  // 2. extract (zip containers are checked against ARCHIVE_LIMITS before inflating, inside extract*)
  // 3. plan page cap. Checked from the PDF page count / PPTX slide list BEFORE any text is extracted, and again on the
  // result (covers DOCX/images). Counters are checked at submit time, so pass zeros.
  const plan: PlanId = await repo.getPlan(doc.userId, now);
  const checkPages = (n: number) => {
    const r = checkQuota(plan, { aiMessagesToday: 0, docsThisMonth: 0 }, { type: "upload_doc", pages: n });
    if (!r.allowed) throw new QuotaExceededError(r.reason, r.message, r.limit);
  };

  let bytes: Uint8Array | null = await storage.read(doc.storagePath);
  // pdf.js detaches its input; only copy when the PDF bytes are still needed afterwards (page rasterisation for OCR)
  const extracted = await extractByKind(v.kind, bytes, checkPages, !deps.rasterizePdfPage);
  if (extracted.length === 0) throw new PipelineError("no_pages", "Document has no pages", false);
  checkPages(extracted.length);

  // 4. OCR fallback for pages without text
  const pages = extracted.map((p) => ({ ...p }));
  const empty = pages.filter((p) => !p.hasText);
  let ocrPages = 0;
  if (empty.length > 0) {
    const ocrAllowed = checkQuota(plan, { aiMessagesToday: 0, docsThisMonth: 0 }, { type: "use_feature", feature: "ocr" }).allowed;
    const canRaster = v.kind === "png" || v.kind === "jpg" || !!deps.rasterizePdfPage;
    if (ocrAllowed && deps.ocr && canRaster) {
      for (const p of empty) {
        await beat();
        const image = v.kind === "png" || v.kind === "jpg" ? bytes! : await deps.rasterizePdfPage!(bytes!, p.page);
        p.text = await deps.ocr.recognize(image, { languages: OCR_LANGUAGES });
        p.hasText = p.text.trim().length > 0;
        if (p.hasText) ocrPages++;
      }
    }
  }
  bytes = null; // release the file buffer before chunking/embedding
  const emptyPages = pages.filter((p) => !p.hasText).map((p) => p.page);
  if (emptyPages.length === pages.length) {
    const why = !checkQuota(plan, { aiMessagesToday: 0, docsThisMonth: 0 }, { type: "use_feature", feature: "ocr" }).allowed
      ? "no extractable text and OCR is not included in the plan"
      : !deps.ocr
        ? "no extractable text and no OCR engine is configured"
        : "no extractable text found";
    throw new PipelineError("no_text", why, false);
  }

  // 5. clean + chunk
  const cleaned = pages.map((p) => ({ page: p.page, text: cleanText(p.text) }));
  const chunks = chunkPages(cleaned, { ...(deps.chunk ?? { maxChars: 1200, overlap: 150 }), docId: documentId });
  if (chunks.length === 0) throw new PipelineError("no_text", "no extractable text found", false);

  // 6. embed (transient provider failures are retryable via the job runner)
  const vectors = await embedAll(
    { repo, provider: deps.provider, models: deps.models },
    doc.userId,
    chunks.map((c) => c.text),
    deps.embedBatchSize,
    beat,
  );
  if (vectors.some((x) => x.length !== EMBEDDING_DIMS)) throw new PipelineError("embed_dims", "Bad embedding dimensions", false);

  // 7. store atomically, then flip status
  await repo.commitDocumentContent({
    documentId,
    pages: cleaned.map((p) => ({ page: p.page, text: p.text })),
    chunks: chunks.map((c, i) => ({
      index: i,
      pageStart: c.page,
      pageEnd: c.pageEnd,
      text: c.text,
      tokenCount: Math.ceil(c.text.length / 4),
      embedding: vectors[i]!,
      sourceId: c.id,
    })),
    pageCount: pages.length,
    ...(fence ? { fence } : {}),
  });
  return { pages: pages.length, chunks: chunks.length, ocrPages, emptyPages };
}

/** Handlers + terminal-failure hook that wire processDocument into the JobRunner. */
export function documentJobRunner(deps: ProcessDeps, workerId: string, opts: { staleLockMs?: number } = {}): JobRunner {
  const handler: JobHandler = async (job) => {
    await processDocument(deps, job.documentId, { jobId: job.id, workerId });
  };
  return new JobRunner({
    repo: deps.repo,
    workerId,
    handlers: { extract_text: handler },
    ...(opts.staleLockMs ? { staleLockMs: opts.staleLockMs } : {}),
    onTerminalFailure: async (job: Job, error: string) => {
      let first: unknown;
      try {
        // never overwrite a document that already became ready (e.g. committed just before a lock expiry)
        await deps.repo.setDocumentStatus(job.documentId, "failed", { error, unlessStatus: "ready" });
      } catch (e) {
        first = e;
      }
      const period = job.payload.quotaPeriod;
      // exactly once: the 'quotaReleased' marker and the counter decrement commit together
      if (typeof period === "string") await deps.repo.releaseJobUsage(job, "upload_doc", period);
      if (first) throw first;
    },
  });
}

/**
 * Entry point used by the process-document function: ownership check, atomic monthly-document quota,
 * idempotent enqueue. A repeated submit returns the existing job without consuming quota again.
 */
export async function submitDocument(
  deps: { repo: Repository; now?: () => Date },
  input: { documentId: string; userId: string },
): Promise<{ job: Job; created: boolean }> {
  const now = (deps.now ?? (() => new Date()))();
  const doc = await deps.repo.getDocument(input.documentId);
  if (!doc || doc.userId !== input.userId) throw new PipelineError("not_found", "Document not found", false);
  if (doc.status === "pending_upload") throw new PipelineError("not_uploaded", "Document has not been uploaded yet", false);

  const plan = await deps.repo.getPlan(input.userId, now);
  const reservation = await consumeQuota(deps.repo, input.userId, plan, { type: "upload_doc", pages: 1 }, now);
  try {
    const job = await deps.repo.enqueueJob({
      documentId: doc.id,
      userId: doc.userId,
      kind: "extract_text",
      idempotencyKey: `process-document:${doc.id}`,
      payload: { quotaPeriod: monthStart(now) },
      runAfter: now,
    });
    if (!job.created) await reservation.release();
    return { job, created: job.created ?? false };
  } catch (e) {
    // The insert may have committed before the error surfaced: look the job up before giving the unit back.
    const existing = await deps.repo.getJobByIdempotencyKey(`process-document:${doc.id}`).catch(() => null);
    if (existing) return { job: existing, created: false };
    await reservation.release().catch(() => {});
    throw new PipelineError("enqueue_failed", sanitizeError(e), true);
  }
}
