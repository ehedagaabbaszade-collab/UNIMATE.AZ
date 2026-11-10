import { z } from "zod";
import type { MessageKey } from "@unimate/i18n";

// ------------------------------------------------------------------ response schemas
// Shapes mirror supabase/functions/* (process-document, ask-document, generate-study-material). The server's
// answer is parsed, never trusted: anything that does not match is surfaced as "bad_response".

export const processResponseSchema = z.object({ jobId: z.string(), created: z.boolean() });

export const citationSchema = z.object({
  chunk_id: z.string().uuid(),
  page_start: z.number().int().nullable(),
  page_end: z.number().int().nullable(),
});
export type StructuredCitation = z.infer<typeof citationSchema>;

export const askResultSchema = z.object({
  answer: z.string(),
  grounded: z.boolean(),
  citations: z.array(citationSchema),
  rejectedCitationIds: z.array(z.string()).default([]),
  suspicious: z.boolean().default(false),
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
});
export type AskResult = z.infer<typeof askResultSchema>;

const generated = <T extends z.ZodType>(output: T) => z.object({ output, cached: z.boolean(), promptVersion: z.number() });
export const summaryResultSchema = generated(z.object({ summary: z.string(), key_points: z.array(z.string()) }));
// The server persists the quiz and returns ids + prompts + options ONLY: the answer key never reaches the client.
export const quizResultSchema = generated(
  z.object({
    quizId: z.string().uuid(),
    outputLanguage: z.string().optional(),
    questions: z.array(z.object({ id: z.string().uuid(), prompt: z.string().min(1), options: z.array(z.string().min(1)) })),
  }),
);
export const flashcardsResultSchema = generated(z.object({ cards: z.array(z.object({ front: z.string().min(1), back: z.string().min(1) })) }));

const errorBodySchema = z.object({ error: z.string(), message: z.string().optional() });

// ------------------------------------------------------------------ error mapping
export type EdgeErrorKind =
  | "provider_not_configured"
  | "quota_exceeded"
  | "not_ready"
  | "not_uploaded"
  | "unauthorized"
  | "not_found"
  | "bad_request"
  | "upstream"
  | "unprocessable"
  | "function_missing"
  | "network"
  | "bad_response"
  | "unknown";

export interface EdgeError {
  kind: EdgeErrorKind;
  status: number;
  code?: string;
  message?: string;
}
export type EdgeResult<T> = { ok: true; data: T } | { ok: false; error: EdgeError };

/** Pure: turns an HTTP failure into a typed error. Unknown bodies never leak raw text into the UI. */
export function mapEdgeFailure(status: number, body: unknown): EdgeError {
  const parsed = errorBodySchema.safeParse(body);
  const code = parsed.success ? parsed.data.error : undefined;
  const message = parsed.success ? parsed.data.message : undefined;
  const base = { status, ...(code ? { code } : {}), ...(message ? { message } : {}) };
  if (status === 503 && code === "ai_not_configured") return { kind: "provider_not_configured", ...base };
  if (status === 429 || code === "quota_exceeded") return { kind: "quota_exceeded", ...base };
  if (code === "not_uploaded") return { kind: "not_uploaded", ...base };
  if (code === "not_ready") return { kind: "not_ready", ...base };
  if (status === 401) return { kind: "unauthorized", ...base };
  if (status === 404 && !code) return { kind: "function_missing", ...base };
  if (status === 404) return { kind: "not_found", ...base };
  if (status === 400) return { kind: "bad_request", ...base };
  if (status === 502 || status === 504) return { kind: "upstream", ...base };
  if (status === 422) return { kind: "unprocessable", ...base };
  return { kind: "unknown", ...base };
}

const KIND_MESSAGE: Record<EdgeErrorKind, MessageKey> = {
  provider_not_configured: "ai.providerNotConfigured",
  quota_exceeded: "ai.quotaExceeded",
  not_ready: "ai.notReady",
  not_uploaded: "ai.notUploaded",
  unauthorized: "ai.unauthorized",
  not_found: "ai.notFound",
  bad_request: "ai.badRequest",
  upstream: "ai.upstream",
  unprocessable: "ai.unprocessable",
  function_missing: "ai.functionMissing",
  network: "ai.network",
  bad_response: "ai.badResponse",
  unknown: "common.genericError",
};
export const edgeErrorMessageKey = (e: EdgeError): MessageKey => KIND_MESSAGE[e.kind];

// ------------------------------------------------------------------ client
export interface EdgeDeps {
  baseUrl: string;
  anonKey: string;
  getAccessToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

export async function callEdge<S extends z.ZodType>(
  deps: EdgeDeps,
  name: "process-document" | "ask-document" | "generate-study-material",
  body: Record<string, unknown>,
  schema: S,
): Promise<EdgeResult<z.infer<S>>> {
  const token = await deps.getAccessToken();
  if (!token) return { ok: false, error: { kind: "unauthorized", status: 401 } };
  let res: Response;
  try {
    res = await (deps.fetchImpl ?? fetch)(`${deps.baseUrl}/functions/v1/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, apikey: deps.anonKey },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: { kind: "network", status: 0 } };
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok) return { ok: false, error: mapEdgeFailure(res.status, json) };
  const parsed = schema.safeParse(json);
  if (!parsed.success) return { ok: false, error: { kind: "bad_response", status: res.status } };
  return { ok: true, data: parsed.data };
}
