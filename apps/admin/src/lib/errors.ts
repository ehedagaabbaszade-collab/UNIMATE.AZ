import type { MessageKey } from "@unimate/i18n";

/** Error carrying only a PostgREST/Postgres code (never server text), so UI messages always come from the catalog. */
export class RpcError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "RpcError";
    this.code = code;
  }
}

/** Maps an error from a Supabase call to an i18n key. Server messages are deliberately not echoed. */
export function errorKey(err: unknown): MessageKey {
  return keyForCode(err instanceof RpcError ? err.code : "");
}

/** Same mapping from a bare code (RpcError.message is the code, which is what useAsync surfaces). */
export function keyForCode(code: string): MessageKey {
  switch (code) {
    case "42501":
      return "admin.err.forbidden";
    case "22023":
    case "23514":
    case "22P02":
    case "23502":
    case "23503":
      return "admin.err.invalid";
    case "55000":
      return "admin.err.conflict";
    case "40001":
      return "admin.universities.changed";
    case "P0002":
      return "admin.err.notFound";
    case "23505":
      return "admin.err.duplicate";
    case "28000":
    case "PGRST301":
      return "admin.err.session";
    case "NOT_CONFIGURED":
      return "admin.err.notConfigured";
    default:
      return "admin.err.generic";
  }
}

export function toRpcError(e: { code?: string | undefined } | null | undefined): RpcError {
  return new RpcError(e?.code ?? "UNKNOWN");
}
