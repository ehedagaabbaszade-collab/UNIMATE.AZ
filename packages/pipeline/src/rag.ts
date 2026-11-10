import { randomUUID } from "node:crypto";
import { z } from "zod";
import { validateCitations, wrapUntrusted, type AiProvider } from "@unimate/core";
import { subRequestId, type GuardedProvider } from "./ai-guard";
import { modelFor, recordUsage, embedAll, type ModelMap } from "./ai";
import { PipelineError, isBillable } from "./errors";
import { LANGUAGE_NAMES, LanguageSchema, type StudyLanguage } from "./languages";
import { consumeQuota } from "./quota";
import type { MatchedChunk, Repository } from "./repository";

export const NOT_GROUNDED_LABEL = "[Not source-grounded] ";
export const NO_CONTEXT_ANSWER = "I could not find relevant content for this question in the document.";
export const MAX_QUESTION_CHARS = 2000;

export interface AskDeps {
  repo: Repository;
  provider: AiProvider;
  /** Legacy tier -> model-name map. Ignored when `guard` is set. Production leaves it out. */
  models?: ModelMap;
  /** DB-routed, budget-guarded provider (embed + rag tasks). Without it the legacy ModelMap path is used (tests). */
  guard?: GuardedProvider;
  now?: () => Date;
  topK?: number;
}
export interface Citation {
  chunk_id: string;
  page_start: number | null;
  page_end: number | null;
}
export interface AskResult {
  answer: string;
  /** True only if at least one citation survived validation. */
  grounded: boolean;
  citations: Citation[];
  rejectedCitationIds: string[];
  /** Retrieved text matched known prompt-injection patterns (it is still fenced as data). */
  suspicious: boolean;
  conversationId: string;
  messageId: string;
}

/**
 * core's validateCitations treats a bracket as an id only if it contains a letter, so an all-digit UUID such as
 * [11111111-1111-4111-8111-111111111111] is left in the text as prose. Our ids are UUIDs, so strip any UUID-shaped
 * marker that was not retrieved.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BRACKET = /([ \t]?)\[([^\][]+)\](\([^)\n]*\))?/g;

/**
 * Runs BEFORE validateCitations: NFKC-normalises (so full-width brackets are seen), lowercases UUIDs, and drops every
 * UUID in any bracket (including multi-id brackets) that was not retrieved. Non-UUID parts are left for core.
 */
export function stripForeignUuids(text: string, retrievedIds: ReadonlySet<string>): { text: string; rejected: string[] } {
  const rejected: string[] = [];
  const out = text.normalize("NFKC").replace(BRACKET, (m, sp: string, inner: string, link: string | undefined) => {
    const parts = inner.split(/[,;\s]+/).filter(Boolean);
    if (!parts.some((x) => UUID_RE.test(x))) return m;
    const keep: string[] = [];
    for (const x of parts) {
      if (!UUID_RE.test(x)) keep.push(x);
      else if (retrievedIds.has(x.toLowerCase())) keep.push(x.toLowerCase());
      else rejected.push(x.toLowerCase());
    }
    return keep.length ? `${sp}[${keep.join(", ")}]${link ?? ""}` : "";
  });
  return { text: out, rejected };
}

// ---------------------------------------------------------------- request schema (used by the edge function)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const AskRequestSchema = z.object({
  documentId: z.string().regex(UUID).transform((s) => s.toLowerCase()),
  question: z.string().max(MAX_QUESTION_CHARS * 4),
  conversationId: z.string().regex(UUID).transform((s) => s.toLowerCase()).optional(),
  /** Language the answer is written in (az/tr/en/ru). Omitted: the answer follows the language of the question. */
  outputLanguage: LanguageSchema.optional(),
  /** Language of the document (optional; stored on a new conversation). Independent of outputLanguage. */
  sourceLanguage: LanguageSchema.optional(),
});
export type AskRequest = z.infer<typeof AskRequestSchema>;
export function parseAskRequest(body: unknown): AskRequest {
  const r = AskRequestSchema.safeParse(body);
  if (!r.success) throw new PipelineError("bad_request", `Invalid request: ${r.error.issues[0]?.path.join(".") || "body"}`, false);
  return r.data;
}

const SYSTEM_RULES =
  "You answer questions about one document using ONLY the excerpts provided. " +
  "Cite every claim with the exact excerpt id in square brackets, e.g. [<id>]. " +
  "If the excerpts do not contain the answer, say so. Answer in the language of the question.";

const formatContext = (chunks: MatchedChunk[]) =>
  chunks.map((c) => `[${c.id}] (page ${c.pageStart ?? "?"})\n${c.text}`).join("\n\n");

/**
 * Retrieve (as the user, through match_chunks + RLS) -> fenced prompt -> generate -> validate citations
 * -> persist the assistant message with only validated citations.
 * Throws ProviderNotConfiguredError when the provider is not configured (the quota unit is given back).
 */
export async function askDocument(
  deps: AskDeps,
  input: {
    userId: string;
    documentId: string;
    question: string;
    conversationId?: string;
    requestId?: string;
    outputLanguage?: StudyLanguage;
    sourceLanguage?: StudyLanguage;
  },
): Promise<AskResult> {
  // Allowlist (interpolated into the prompt): checked before any quota or model use.
  for (const [k, v] of [["outputLanguage", input.outputLanguage], ["sourceLanguage", input.sourceLanguage]] as const)
    if (v !== undefined && !LanguageSchema.safeParse(v).success)
      throw new PipelineError("bad_request", `${k} must be one of az, tr, en, ru`, false);
  const langOpts = {
    ...(input.outputLanguage ? { outputLanguage: input.outputLanguage } : {}),
    ...(input.sourceLanguage ? { sourceLanguage: input.sourceLanguage } : {}),
  };
  const { repo, provider, models, guard } = deps;
  const requestBase = input.requestId ?? randomUUID();
  const now = (deps.now ?? (() => new Date()))();
  const question = input.question.trim();
  if (!question || question.length > MAX_QUESTION_CHARS)
    throw new PipelineError("invalid_question", `Question must be 1-${MAX_QUESTION_CHARS} characters`, false);

  const doc = await repo.getDocument(input.documentId);
  if (!doc || doc.userId !== input.userId) throw new PipelineError("not_found", "Document not found", false);
  if (doc.status !== "ready") throw new PipelineError("not_ready", "Document is not ready yet", false);

  let conversationId = input.conversationId;
  if (conversationId) {
    const owner = await repo.conversationOwner(conversationId);
    if (!owner || owner.userId !== input.userId || owner.documentId !== input.documentId)
      throw new PipelineError("not_found", "Conversation not found", false);
  }

  // A document without chunks cannot be answered: do not consume quota or pay for an embedding.
  const noContext = async (): Promise<AskResult> => {
    conversationId ??= await repo.createConversation(input.userId, input.documentId, question.slice(0, 80), langOpts);
    await repo.insertMessage({ conversationId, role: "user", content: question });
    const messageId = await repo.insertMessage({ conversationId, role: "assistant", content: NOT_GROUNDED_LABEL + NO_CONTEXT_ANSWER });
    return { answer: NOT_GROUNDED_LABEL + NO_CONTEXT_ANSWER, grounded: false, citations: [], rejectedCitationIds: [], suspicious: false, conversationId, messageId };
  };
  if ((await repo.getChunks(input.documentId, 1)).length === 0) return noContext();

  const plan = await repo.getPlan(input.userId, now);
  const reservation = await consumeQuota(repo, input.userId, plan, { type: "ai_message" }, now);
  let spent = false;
  try {
    const [qVec] = await embedAll(
      { repo, provider, ...(models ? { models } : {}) },
      input.userId,
      [question],
      64,
      undefined,
      guard ? { guard, plan, requestBase } : undefined,
    );
    spent = true; // the embedding call is paid: nothing after this point refunds (including zero retrieval)
    const retrieved = await repo.matchChunks(input.userId, qVec!, input.documentId, deps.topK ?? 6);

    if (retrieved.length === 0) return await noContext();

    conversationId ??= await repo.createConversation(input.userId, input.documentId, question.slice(0, 80), langOpts);
    await repo.insertMessage({ conversationId, role: "user", content: question });

    const fenced = wrapUntrusted(formatContext(retrieved));
    const system = `${SYSTEM_RULES}${input.outputLanguage ? ` Write the answer in ${LANGUAGE_NAMES[input.outputLanguage]}.` : ""}
${fenced.notice}`;
    const prompt = `${fenced.fenced}

Question: ${question}`;
    let gen: { text: string; model: string; usage: { inputTokens: number; outputTokens: number } };
    if (guard) {
      // Document Q&A is routed as the `rag` task (separate model/price/limits from free-form `chat`).
      gen = await guard.generate({ userId: input.userId, plan, requestId: subRequestId(requestBase, "answer") }, "rag", { system, prompt });
      spent = true;
    } else {
      if (!models) throw new PipelineError("ai_not_configured", "No model map or guard configured", false);
      const { tier, model } = modelFor(models, plan, "chat");
      gen = await provider.generate({ task: "chat", model, system, prompt });
      spent = true; // the paid call returned: nothing after this point refunds
      await recordUsage(repo, input.userId, "chat", tier, gen.model, gen.usage);
    }

    const byId = new Map(retrieved.map((c) => [c.id.toLowerCase(), c]));
    const pre = stripForeignUuids(gen.text, new Set(byId.keys()));
    const v = validateCitations(
      pre.text,
      retrieved.map((c) => ({ id: c.id.toLowerCase(), ...(c.pageStart !== null ? { page: c.pageStart } : {}), text: c.text })),
    );
    const rejected = new Set([...pre.rejected, ...v.rejectedIds]);
    const cleanedAnswer = v.cleanedAnswer.trim();
    const citations: Citation[] = v.validIds.map((id) => ({
      chunk_id: id,
      page_start: byId.get(id)?.pageStart ?? null,
      page_end: byId.get(id)?.pageEnd ?? null,
    }));
    const grounded = citations.length > 0;
    const answer = grounded ? cleanedAnswer : NOT_GROUNDED_LABEL + (cleanedAnswer || NO_CONTEXT_ANSWER);

    const messageId = await repo.insertMessage({
      conversationId,
      role: "assistant",
      content: answer,
      citations,
      model: gen.model,
      inputTokens: gen.usage.inputTokens,
      outputTokens: gen.usage.outputTokens,
    });
    return { answer, grounded, citations, rejectedCitationIds: [...rejected], suspicious: fenced.suspicious, conversationId, messageId };
  } catch (e) {
    if (!spent && !isBillable(e)) await reservation.release().catch(() => {});
    throw e;
  }
}
