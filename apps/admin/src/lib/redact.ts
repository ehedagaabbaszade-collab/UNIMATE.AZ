/** Masks anything that could be a credential or personal identifier before audit metadata is shown or exported. */
export const REDACTED = "[redacted]";
const SENSITIVE_KEY = /(pass(word|wd)?|secret|token|api[_-]?key|private[_-]?key|authorization|cookie|jwt|credential|e-?mail|phone|session|signature|otp)/i;
const EMAIL = /[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+/g;
const JWT = /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/g;
const BEARER = /\bBearer\s+[\w.~+/-]+=*/gi;
const MAX_STRING = 500;
const MAX_DEPTH = 8;

export function redactString(s: string): string {
  const masked = s.replace(JWT, "[redacted-token]").replace(BEARER, "Bearer [redacted-token]").replace(EMAIL, "[redacted-email]");
  return masked.length > MAX_STRING ? `${masked.slice(0, MAX_STRING)}…` : masked;
}
export function redact(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? REDACTED : redact(v, depth + 1)]));
}
