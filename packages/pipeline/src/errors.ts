/** Error with a stable machine code. `retryable` decides retry vs. terminal failure in the job runner. */
export class PipelineError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  /** True when a paid provider call may have been made/answered: the quota unit must NOT be refunded. */
  readonly billable: boolean;
  constructor(code: string, message: string, retryable = false, billable = false) {
    super(message);
    this.name = "PipelineError";
    this.code = code;
    this.retryable = retryable;
    this.billable = billable;
  }
}

/** Refund only when the request was never sent or was refused; anything else (timeouts, bad bodies) is spent. */
export const isBillable = (e: unknown): boolean => e instanceof PipelineError && e.billable;

const MAX_ERROR_CHARS = 300;

const REDACTIONS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=*-]{8,}/gi, "Bearer [redacted]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "[redacted-jwt]"],
  // '*' and '.' are included so providers' masked keys ("sk-proj-********abcd") are redacted too
  [/\b(sk|pk|rk|gsk|xai)-[A-Za-z0-9_.*-]{8,}/g, "[redacted-key]"],
  [/\b(api[_-]?key|apikey|token|secret|password|authorization|x-api-key)(["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi, "$1$2[redacted]"],
  [/([?&](?:key|api_key|apikey|token|access_token)=)[^&\s]+/gi, "$1[redacted]"],
  [/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted-dsn]"],
];

/**
 * Text safe to store in processing_jobs.last_error / documents.error: no stack, no secrets, bounded.
 * PipelineError messages are authored by us; anything else is reduced to its class name plus a redacted,
 * truncated message.
 */
export function sanitizeError(e: unknown): string {
  let text: string;
  if (e instanceof PipelineError) text = `${e.code}: ${e.message}`;
  else if (e instanceof Error) text = `${e.name}: ${e.message}`;
  else text = "Unknown error";
  text = text.split("\n")[0] ?? "";
  for (const [re, rep] of REDACTIONS) text = text.replace(re, rep);
  // eslint-disable-next-line no-control-regex
  text = text.replace(/[\u0000-\u001F\u007F]/g, " ");
  return text.length > MAX_ERROR_CHARS ? `${text.slice(0, MAX_ERROR_CHARS)}...` : text;
}

/**
 * What an HTTP client may see. Details of provider and database failures (which can echo request data, key
 * fragments, hostnames, SQL) are replaced by a fixed message; they belong in server logs only (sanitizeError).
 */
export function publicError(e: PipelineError): { code: string; message: string } {
  if (e.code.startsWith("provider_")) return { code: e.code, message: "The AI provider is unavailable. Please try again later." };
  if (e.code === "enqueue_failed") return { code: e.code, message: "Could not queue the document. Please try again." };
  if (e.code.startsWith("storage_")) return { code: e.code, message: "Could not access the stored file." };
  return { code: e.code, message: e.message };
}
